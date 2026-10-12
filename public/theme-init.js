(function () {
  var stored = 'light';
  try {
    stored = localStorage.getItem('theme') || localStorage.getItem('qc-theme') || 'light';
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', stored);
  var bg = stored === 'dark' ? '#1a1214' : (stored === 'light' ? '#fbf4ee' : (stored === 'eyecare' ? '#15130f' : ''));
  if (bg) {
    document.documentElement.style.backgroundColor = bg;
  }
  if (document.body) {
    document.body.classList.remove('theme-light', 'theme-dark', 'theme-eyecare');
    document.body.classList.add('theme-' + stored);
    if (bg) document.body.style.backgroundColor = bg;
  }
})();
