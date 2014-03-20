// Displays the HTML source of a CodeMirror editor as a rendered preview
// in an iframe.
define(["jquery", "backbone-events", "./mark-tracker"], function($, BackboneEvents, markTracker) {
  "use strict";

  var Preferences = require("fc/prefs"),
      showMappings = true,
      updateFrame = function(bool) {};

  function LivePreview(options) {
    var self = {codeMirror: options.codeMirror, title: ""},
        codeMirror = options.codeMirror,
        iframe = document.createElement("iframe"),
        previewLoader = options.previewLoader || "/templates/previewloader.html",
        previewArea = options.previewArea,
        marks = markTracker(codeMirror),
        telegraph,        // communication channel to the preview iframe
        knownDoc,         // the latest known document generated by slowparse
        findElementRoute; // route finder in the knownDoc

    Preferences.on("change:showMapping", function() {
      showMappings = Preferences.get("showMapping") === true;
      updateFrame(showMappings);
      if(!showMappings) {
        marks.clear();
      }
    });

    // event listening for proxied event messages from our preview iframe.
    function listenForEvents() {
      window.addEventListener("message", function(evt) {
        var message = JSON.parse(evt.data);
        if (typeof message.type !== "string" || message.type.indexOf("previewloader") === -1) {
          return;
        }
        marks.clear();
        var route = message.route.slice();
        if(route.length > 0) {
          var e = knownDoc.querySelector("body");
          while(route.length > 0) {
            e = e.childNodes[route.pop()];
          }
          var parseInfo = e.parseInfo,
              start = parseInfo.openTag.start,
              end = (parseInfo.closeTag ? parseInfo.closeTag.end : parseInfo.openTag.end);
          marks.mark(start, end, "preview-to-editor-highlight");
          if (message.type === "previewloader:click") {
            codeMirror.scrollIntoView(codeMirror.posFromIndex(start));
          }
        }
      });
    }

    // set up the iframe so that it always triggers an initial
    // content injection by telling codemirror to reparse on load:
    iframe.onload = function() {
      codeMirror.reparse();
    };

    // then set up the preview load from URL
    iframe.src = previewLoader;

    // set up the code-change handling.
    codeMirror.on("reparse", function(event) {
      if (!event.error || options.ignoreErrors) {
        // add the preview iframe to the editor on the first
        // attempt to parse the Code Mirror text.
        if(!iframe.contentWindow) {
          document.querySelector(".reload-button").onclick = function() {
            codeMirror.reparse();
          };
          previewArea.append(iframe);
          telegraph = iframe.contentWindow;
          listenForEvents();
        }

        // Communicate content changes. For the moment,
        // we treat all changes as a full refresh.
        var message = {
          type: "overwrite",
          runjs: document.getElementById('preview-run-js').checked,
          sourceCode: event.sourceCode,
          showMappings: showMappings
        };

        // record current doc
        knownDoc = event.document;
        findElementRoute = event.findElementRoute;

        updateFrame = function(bool) {
          message.showMappings = bool;
          try {
            // targetOrigin is current a blanket allow, we'll want to
            // narrow it down once scripts in Thimble are operational.
            // See: https://bugzilla.mozilla.org/show_bug.cgi?id=891521
            telegraph.postMessage(JSON.stringify(message), "*");
          } catch (e) {
            console.log("An error occurred while postMessaging data to the preview pane");
            throw e;
          }
        };

        updateFrame(showMappings);
      }
    });

    var setViewLink = self.setViewLink = function(link) {
      self.trigger("change:viewlink", link);
    };

    // map-back from preview to codemirror
    window.addEventListener("message", function(evt) {
      if (!showMappings) return;
      var d = JSON.parse(evt.data);
      if (d.type !== "previewloader:click") return;
      marks.clear();
      var route = d.route;
      if(route.length > 0) {
        var e = knownDoc.querySelector("body");
        while(route.length > 0) {
          e = e.childNodes[route.splice(0,1)[0]];
        }
        var start = e.parseInfo.openTag.start,
            end = e.parseInfo.closeTag ? e.parseInfo.closeTag.end : e.parseInfo.startTag.end;
        marks.mark(start, end, "preview-to-editor-highlight");
        codeMirror.scrollIntoView(codeMirror.posFromIndex(start));
      }
    });

    // map-forward from codemirror to preview
    codeMirror.on("cursorActivity", function(cm, activity) {
      if (!showMappings) return;
      if (!findElementRoute) return;
      var position = codeMirror.indexFromPos(codeMirror.getCursor());
      var route = findElementRoute(position);

      // Communicate content changes. For the moment,
      // we treat all changes as a full refresh.
      var message = JSON.stringify({
        type: "setcursor",
        position: position,
        route: route
      });

      try {
        telegraph.postMessage(message, "*");
      } catch (e) {
        console.log("An error occurred while postMessaging the cursor position to the preview pane");
        throw e;
      }

    });

    BackboneEvents.mixin(self);
    return self;
  }

  return LivePreview;
});
