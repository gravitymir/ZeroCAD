// Расширение ZeroCAD: клик по значку открывает редактор во вкладке.
// Редактор — те же web/index.html и app.js, что отдаёт Rust-сервер.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({url: chrome.runtime.getURL('index.html')});
});
