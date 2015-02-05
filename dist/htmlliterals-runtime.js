(function (package) {
    // nano-implementation of require.js-like define(name, deps, impl) for internal use
    var definitions = {},
        symbol = 'htmlliterals',
        p;

    package(function define(name, deps, fn) {
        if (definitions.hasOwnProperty(name)) throw new Error("define: cannot redefine module " + name);
        definitions[name] = fn.apply(null, deps.map(function (dep) {
            if (!definitions.hasOwnProperty(dep)) throw new Error("define: module " + dep + " required by " + name + " has not been defined.");
            return definitions[dep];
        }));
    });

    if (typeof module === 'object' && typeof module.exports === 'object')  // CommonJS
        module.exports = definitions.export;
    else if (typeof define === 'function')  // AMD
        define([], function () { return definitions.export; });
    else if (typeof this[symbol] !== 'undefined') // existing global object
        for (p in definitions.export) this[symbol][p] = definitions.export[p];
    else // new global object
        this[symbol] = definitions.export;

})(function (define) {
    "use strict";

// internal cross-browser library of required DOM functions
define('domlib', [], function () {
    return {
        addEventListener: function addEventListener(node, event, fn) {
            node.addEventListener(event, fn, false);
        },

        removeEventListener: function removeEventListener(node, event, fn) {
            node.removeEventListener(event, fn);
        },

        classListContains: function (el, name) {
            return el.classList.contains(name);
        },

        classListAdd: function (el, name) {
            return el.classList.add(name);
        },

        classListRemove: function (el, name) {
            return el.classList.remove(name);
        }
    };
});

define('parse', [], function () {
    var matchOpenTag = /<(\w+)/,
        containerElements = {
            "li": "ul",
            "td": "tr",
            "th": "tr",
            "tr": "tbody",
            "thead": "table",
            "tbody": "table",
            "dd": "dl",
            "dt": "dl",
            "head": "html",
            "body": "html"
        };

    return function parse(html) {
        var container = document.createElement(containerElement(html)),
            len,
            frag;

        container.innerHTML = html;
        len = container.childNodes.length;

        if (len === 0) {
            // special case: empty text node gets swallowed, so create it directly
            if (html === "") return document.createTextNode("");
            throw new Error("HTML parse failed for: " + html);
        } else if (len === 1) {
            return container.childNodes[0];
        } else {
            frag = document.createDocumentFragment();

            while(container.childNodes.length !== 0) {
                frag.appendChild(container.childNodes[0]);
            }

            return frag;
        }
    }

    function containerElement(html) {
        var m = matchOpenTag.exec(html);
        return m && containerElements[m[1].toLowerCase()] || "div";
    }
});

define('cachedParse', ['parse'], function (parse) {
    var cache = {};

    return function cachedParse(id, html) {
        var cached = cache[id];

        if (cached === undefined) {
            cached = parse(html);
            cache[id] = cached;
        }

        return cached.cloneNode(true);
    }
})

define('Shell', ['parse', 'cachedParse'], function (parse, cachedParse) {
    function Shell(node, cache) {
        if (node.nodeType === undefined)
            node = cache ? cachedParse(node, cache) : parse(node);

        this.node = node;
    }

    Shell.prototype = {
        childNodes: function childNodes(indices, fn) {
            var children = this.node.childNodes,
                len = indices.length,
                childShells = new Array(len),
                i, child;

            if (children === undefined)
                throw new Error("Shell.childNodes can only be applied to a node with a \n"
                    + ".childNodes collection.  Node ``" + this.node + "'' does not have one. \n"
                    + "Perhaps you applied it to the wrong node?");

            for (i = 0; i < len; i++) {
                child = children[indices[i]];
                if (!child)
                    throw new Error("Node ``" + this.node + "'' does not have a child at index " + i + ".");

                childShells[i] = new Shell(child);
            }

            fn(childShells);

            return this;
        },

        property: function property(setter) {
            setter(this.node);
            return this;
        }
    };

    Shell.addDirective = function addDirective(name, fn) {
        Shell.prototype[name] = function directive(values) {
            Shell.runDirective(fn, this.node, values);
            return this;
        };
    };

    Shell.runDirective = function runDirective(fn, node, values) {
        values(fn(node));
    };

    Shell.cleanup = function (node, fn) {
        // nothing right now -- this is primarily a hook for S.cleanup
        // will consider a non-S design, like perhaps adding a .cleanup()
        // closure to the node.
    };

    return Shell;
});

define('directives.class', ['Shell', 'domlib'], function (Shell, domlib) {
    Shell.addDirective('class', function (node) {
        if (node.className === undefined)
            throw new Error("@class can only be applied to an element that accepts class names. \n"
                + "Element ``" + node + "'' does not. Perhaps you applied it to the wrong node?");

        return function classDirective(on, off, flag) {
            if (arguments.length < 3) flag = off, off = null;

            var hasOn = domlib.classListContains(node, on),
                hasOff = off && domlib.classListContains(node, off);

            if (flag) {
                if (!hasOn) domlib.classListAdd(node, on);
                if (off && hasOff) domlib.classListRemove(node, off);
            } else {
                if (hasOn) domlib.classListRemove(node, on);
                if (off && !hasOff) domlib.classListAdd(node, off);
            }
        };
    });
});

define('directives.focus', ['Shell'], function (Shell) {
    Shell.addDirective('focus', function focus(node) {
        return function focus(flag) {
            flag ? node.focus() : node.blur();
        };
    });
});

define('directives.insert', ['Shell'], function (Shell) {
    Shell.addDirective('insert', function (node) {
        var parent,
            start,
            cursor;

        return function insert(value) {
            parent = node.parentNode;

            if (!parent)
                throw new Error("@insert can only be used on a node that has a parent node. \n"
                    + "Node ``" + node + "'' is currently unattached to a parent.");

            if (start) {
                if (start.parentNode !== parent)
                    throw new Error("@insert requires that the inserted nodes remain sibilings \n"
                        + "of the original node.  The DOM has been modified such that this is \n"
                        + "no longer the case.");

                //clear(start, node);
            } else start = marker(node);

            cursor = start;

            insert(value);

            clear(cursor, node);
        };

        // value ::
        //   null or undefined
        //   string
        //   node
        //   array of value
        function insertValue(value) {
            var next = cursor.nextSibling;

            if (value === null || value === undefined) {
                // nothing to insert
            } else if (value.nodeType /* instanceof Node */) {
                if (next !== value) {
                    parent.insertBefore(value, next);
                }
                cursor = value;
            } else if (Array.isArray(value)) {
                insertArray(value);
            } else {
                value = value.toString();

                if (next.nodeType !== 3 || next.data !== value) {
                    cursor = parent.insertBefore(document.createTextNode(value), next);
                } else {
                    cursor = next;
                }
            }
        }

        function insertArray(array) {
            var i, len, prev;
            for (i = 0, len = array.length; i < len; i++) {
                insert(array[i]);
                // if we've enjambed two text nodes, separate them with a space
                if (prev
                    && prev.nodeType == 3
                    && prev.nextSibling !== node
                    && prev.nextSibling.nodeType === 3)
                {
                    parent.insertBefore(document.createTextNode(" "), prev.nextSibling);
                }
                prev = node.previousSibling;
            }
        }

        function clear(start, end) {
            var next = start.nextSibling;
            while (next !== end) {
                parent.removeChild(next);
                next = start.nextSibling;
            }
        }

        function marker(el) {
            return parent.insertBefore(document.createTextNode(""), el);
        }
    });
});

define('directives.onkey', ['Shell', 'domlib'], function (Shell, domlib) {
    Shell.addDirective('onkey', function (node) {
        return function onkey(key, event, fn) {
            if (arguments.length < 3) fn = event, event = 'down';

            var keyCode = keyCodes[key.toLowerCase()];

            if (keyCode === undefined)
                throw new Error("@onkey: unrecognized key identifier '" + key + "'");

            if (typeof fn !== 'function')
                throw new Error("@onkey: must supply a function to call when the key is entered");

            domlib.addEventListener(node, 'key' + event, onkeyListener);
            Shell.cleanup(node, function () { domlib.removeEventListener(node, 'key' + event, onkeyListener); });

            function onkeyListener(e) {
                if (e.keyCode === keyCode) fn();
                return true;
            }
        };
    });

    var keyCodes = {
        backspace:  8,
        tab:        9,
        enter:      13,
        shift:      16,
        ctrl:       17,
        alt:        18,
        pause:      19,
        break:      19,
        capslock:   20,
        esc:        27,
        space:      32,
        pageup:     33,
        pagedown:   34,
        end:        35,
        home:       36,
        leftarrow:  37,
        uparrow:    38,
        rightarrow: 39,
        downarrow:  40,
        prntscrn:   44,
        insert:     45,
        delete:     46,
        "0":        48,
        "1":        49,
        "2":        50,
        "3":        51,
        "4":        52,
        "5":        53,
        "6":        54,
        "7":        55,
        "8":        56,
        "9":        57,
        a:          65,
        b:          66,
        c:          67,
        d:          68,
        e:          69,
        f:          70,
        g:          71,
        h:          72,
        i:          73,
        j:          74,
        k:          75,
        l:          76,
        m:          77,
        n:          78,
        o:          79,
        p:          80,
        q:          81,
        r:          82,
        s:          83,
        t:          84,
        u:          85,
        v:          86,
        w:          87,
        x:          88,
        y:          89,
        z:          90,
        winkey:     91,
        winmenu:    93,
        f1:         112,
        f2:         113,
        f3:         114,
        f4:         115,
        f5:         116,
        f6:         117,
        f7:         118,
        f8:         119,
        f9:         120,
        f10:        121,
        f11:        122,
        f12:        123,
        numlock:    144,
        scrolllock: 145,
        ",":        188,
        "<":        188,
        ".":        190,
        ">":        190,
        "/":        191,
        "?":        191,
        "`":        192,
        "~":        192,
        "[":        219,
        "{":        219,
        "\\":       220,
        "|":        220,
        "]":        221,
        "}":        221,
        "'":        222,
        "\"":       222
    };
});

define('export', ['parse', 'cachedParse', 'Shell', 'domlib'], function (parse, cachedParse, Shell, domlib) {
    return {
        parse: parse,
        cachedParse: cachedParse,
        Shell: Shell,
        domlib: domlib
    };
});

});
