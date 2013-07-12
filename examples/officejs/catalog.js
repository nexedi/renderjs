/*global window, jQuery, rJS */
"use strict";
(function (window, $, rJS, undefined) {

  var gk = rJS(window),
    io_dict = {
        "path" :      "./io.html",
        "title" :     "IO",
        "interface" : "http://www.renderjs.org/interface/io",
      },
    editor_1_dict = {
        "path" :      "./editor.html",
        "title" :     "Simple Text Editor Gadget",
        "interface" : "http://www.renderjs.org/interface/editor",
      },
    editor_2_dict = {
        "path" :      "./jqteditor.html",
        "title" :     "JQuery Text Editor Gadget",
        "interface" : "http://www.renderjs.org/interface/editor",
      },
    catalog_list = [
      {
        "path" :      "./officejs.html",
        "title" :     "Office JS",
        "interface" : "http://www.renderjs.org/interface/officejs",
      },
    ];

  catalog_list.push(io_dict);
  catalog_list.push(editor_1_dict);
  catalog_list.push(editor_2_dict);

  gk.declareMethod('allDocs', function (filter) {
    var deferred = $.Deferred();
    if (filter === undefined) {
      deferred.resolve(catalog_list);
    } else if (filter.query ===
        'interface: "http://www.renderjs.org/interface/io"') {
      deferred.resolve([io_dict]);
    } else if (filter.query ===
        'interface: "http://www.renderjs.org/interface/editor"') {
      deferred.resolve([editor_1_dict, editor_2_dict]);
    } else {
      deferred.reject("Unsupported filter");
    }
    return deferred.promise();
  });

}(window, $, rJS))
