document.getElementById("swap").addEventListener("click", () => {
  history.pushState({}, "", "#swapped");
  document.getElementById("article").innerHTML = `
    <h1>Swapped Dark Article</h1>
    <p>This article arrived after a simulated single-page app route transition.</p>
    <p>Light Reader should notice the content change, score the new article, and keep the reading surface comfortable.</p>
    <p>The detector should not require a full browser reload to make a fresh page-state decision.</p>
  `;
});
