/* ===========================================================
   DEMOLITION — vim.js
   Vim-style page navigation for Level 2 pages:
   - j/k: scroll
   - f: link hints
   - Esc: cancel hint mode
   =========================================================== */

(function () {
  "use strict";

  var scrollStep = 110;
  var hintMode = false;
  var hintBuffer = "";
  var hintEntries = [];
  var hintLayer = null;

  function isEditable(target) {
    if (!target) return false;
    var tag = (target.tagName || "").toLowerCase();
    if (target.isContentEditable) return true;
    return tag === "input" || tag === "textarea" || tag === "select";
  }

  function isVimActive() {
    var root = document.documentElement;
    return (
      root.getAttribute("data-demolition-level") === "2" &&
      root.getAttribute("data-demolition-vim") === "on"
    );
  }

  function isVisible(element) {
    if (!element) return false;
    var rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    if (rect.bottom < 0 || rect.right < 0) return false;
    if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
    return true;
  }

  function clearHints() {
    hintMode = false;
    hintBuffer = "";
    hintEntries = [];
    if (hintLayer && hintLayer.parentNode) {
      hintLayer.parentNode.removeChild(hintLayer);
    }
    hintLayer = null;
  }

  function collectHintTargets() {
    var selectors = [
      "a[href]",
      "button",
      "input[type='button']",
      "input[type='submit']",
      "[role='button']",
      "[onclick]"
    ];

    var nodes = document.querySelectorAll(selectors.join(","));
    var targets = [];
    for (var i = 0; i < nodes.length; i += 1) {
      if (!isVisible(nodes[i])) continue;
      targets.push(nodes[i]);
      if (targets.length >= 150) break;
    }
    return targets;
  }

  function renderHints() {
    clearHints();

    var targets = collectHintTargets();
    if (!targets.length) return;

    hintLayer = document.createElement("div");
    hintLayer.setAttribute("data-demolition-ui", "hint-layer");
    hintLayer.setAttribute("data-demolition-hints", "on");
    hintLayer.style.position = "fixed";
    hintLayer.style.left = "0";
    hintLayer.style.top = "0";
    hintLayer.style.width = "100vw";
    hintLayer.style.height = "100vh";
    hintLayer.style.zIndex = "2147483647";
    hintLayer.style.pointerEvents = "none";

    targets.forEach(function (target, idx) {
      var rect = target.getBoundingClientRect();
      var label = String(idx + 1);
      var tag = document.createElement("span");

      tag.textContent = label;
      tag.style.position = "fixed";
      tag.style.left = Math.max(2, rect.left).toFixed(0) + "px";
      tag.style.top = Math.max(2, rect.top).toFixed(0) + "px";
      tag.style.padding = "1px 4px";
      tag.style.fontSize = "11px";
      tag.style.zIndex = "2147483647";
      tag.style.pointerEvents = "none";

      hintLayer.appendChild(tag);
      hintEntries.push({ label: label, target: target, tag: tag });
    });

    document.documentElement.appendChild(hintLayer);
    hintMode = true;
  }

  function activateHintByBuffer() {
    if (!hintBuffer) return;
    var matches = hintEntries.filter(function (entry) {
      return entry.label.indexOf(hintBuffer) === 0;
    });

    hintEntries.forEach(function (entry) {
      entry.tag.style.opacity = entry.label.indexOf(hintBuffer) === 0 ? "1" : "0.2";
    });

    if (matches.length === 1 && matches[0].label === hintBuffer) {
      var target = matches[0].target;
      clearHints();
      target.focus({ preventScroll: true });
      target.click();
      return;
    }

    if (!matches.length) {
      clearHints();
    }
  }

  document.addEventListener(
    "keydown",
    function (event) {
      if (!isVimActive()) {
        if (hintMode) clearHints();
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!hintMode && isEditable(event.target)) return;

      if (event.key === "Escape") {
        if (hintMode) {
          event.preventDefault();
          clearHints();
        }
        return;
      }

      if (hintMode) {
        if (/^[0-9]$/.test(event.key)) {
          event.preventDefault();
          hintBuffer += event.key;
          activateHintByBuffer();
        }
        return;
      }

      if (event.key === "j") {
        event.preventDefault();
        window.scrollBy({ top: scrollStep, behavior: "auto" });
        return;
      }

      if (event.key === "k") {
        event.preventDefault();
        window.scrollBy({ top: -scrollStep, behavior: "auto" });
        return;
      }

      if (event.key === "f") {
        event.preventDefault();
        renderHints();
      }
    },
    true
  );
})();
