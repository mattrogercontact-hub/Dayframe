(() => {
  let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  try {
    const saved = JSON.parse(localStorage.getItem('dayframe.display.v1') || 'null')
    if (saved?.version === 1 && ['light', 'dark', 'cozy', 'contrast'].includes(saved.theme)) theme = saved.theme
  } catch { /* Use the device preference when storage is unavailable. */ }
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = ['dark', 'contrast'].includes(theme) ? 'dark' : 'light'
})()
