/**
 * The DOM analysis script SEs run today in each page's console, verbatim.
 * Its output is the profile `parseDomProfile` imports. It records only the
 * highest z-index, cannot read cross-origin iframes, cannot tell the
 * application's elements from Apty's or an extension's, can be cut short
 * by the console, and records no run metadata.
 */
export const DOM_CONFIG_CONSOLE_SCRIPT = `// Run in the console of each page. Result is copied to the clipboard.

var makeSafe = function(fn){
  return function(){
    try{ return fn.apply(this, arguments); }
    catch(error){ console.error("DOM Analysis error: ", error); }
  };
};

var getAllElements = makeSafe((root) => root.querySelectorAll('*'));

var crossOriginCount = 1;
var getIFrameOrigin = (element) => {
  var origin = "";
  try {
    origin = element.contentWindow && element.contentWindow.location.href;
  } catch(e) {
    origin = \`Cross Origin \${crossOriginCount} (src: \${element.src})\`;
    crossOriginCount++;
  }
  return origin;
}

var isCrossOriginFrame = makeSafe((element) => {
  var isCrossOrigin = false;
  try {
    var origin = element.contentWindow && element.contentWindow.location.origin;
    isCrossOrigin = window.top.location.origin !== origin;
  } catch(e) { isCrossOrigin = true; }
  return isCrossOrigin;
});

var findIFrame = makeSafe((tag, element, elementsOutput) => {
  if (tag === 'iframe') {
    var origin = getIFrameOrigin(element);
    if (!elementsOutput.iframes) elementsOutput.iframes = {};
    if (!elementsOutput.iframes[origin]) {
      elementsOutput.iframes[origin] = { isCrossOrigin: isCrossOriginFrame(element) }
      var frameElements = getAllElements(element.contentDocument && element.contentDocument);
      if (frameElements && frameElements.length) {
        startDomAnalysis(frameElements, elementsOutput.iframes[origin]);
      }
    }
  }
});

var findAttributes = makeSafe((element, elementsOutput) => {
  for (var j = 0; j < (element.attributes || []).length; j++) {
    var attribute = element.attributes[j];
    if (!elementsOutput.attributes) elementsOutput.attributes = {};
    if (!elementsOutput.attributes[attribute.name]) elementsOutput.attributes[attribute.name] = {};
    if (!elementsOutput.attributes[attribute.name][attribute.value]) elementsOutput.attributes[attribute.name][attribute.value] = 0;
    elementsOutput.attributes[attribute.name][attribute.value]++;
  }
});

var findShadowRoots = makeSafe((tag, element, elementsOutput) => {
  if (element && element.shadowRoot instanceof DocumentFragment) {
    if (!elementsOutput.shadowRoots) elementsOutput.shadowRoots = {};
    if (!elementsOutput.shadowRoots[tag]) {
      elementsOutput.shadowRoots[tag] = {};
      var shadowRootElements = getAllElements(element.shadowRoot);
      if (shadowRootElements && shadowRootElements.length) {
        startDomAnalysis(shadowRootElements, elementsOutput.shadowRoots[tag]);
      }
    }
  }
});

var findMaxZIndex = makeSafe((element, elementsOutput) => {
  var styles = window.getComputedStyle(element);
  var zIndex = +(styles && styles.zIndex) || 0;
  if (zIndex) {
    if (!elementsOutput.maxZIndex) elementsOutput.maxZIndex = 0;
    if (zIndex > elementsOutput.maxZIndex) elementsOutput.maxZIndex = zIndex;
  }
});

var startDomAnalysis = makeSafe((elements, elementsOutput) => {
  if (!elementsOutput) elementsOutput = {};
  for (var i = 0; i < (elements || []).length; i++) {
    var element = elements[i];
    if (!element) continue;
    var tag = (element.tagName || '').toLowerCase();
    if (!elementsOutput.tags) elementsOutput.tags = {};
    if (!elementsOutput.tags[tag]) elementsOutput.tags[tag] = 0;
    elementsOutput.tags[tag]++;
    findAttributes(element, elementsOutput);
    findMaxZIndex(element, elementsOutput);
    findIFrame(tag, element, elementsOutput);
    findShadowRoots(tag, element, elementsOutput);
  }
  return elementsOutput;
});

var allElements = getAllElements(document);
var domAnalysis = startDomAnalysis(allElements);
var domAnalysisString = JSON.stringify(domAnalysis);
copy(domAnalysisString);
console.log('Copied to clipboard. Size:', domAnalysisString.length, 'characters');
`;
