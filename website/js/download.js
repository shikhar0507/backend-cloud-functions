function hideElement(element) {
  if (!element) return;

  element.style.display = 'none';
}


function changeLink() {
  const ua = getMobileOperatingSystem();
  let elem = '';

  if (ua === 'unknown') return;

  if (ua === 'Android') {
    // hide iOs link
    elem = document.getElementById('app-store-link');
  }

  if (ua === 'iOS') {
    // hide Android link

    elem = document.getElementById('play-store-link');
  }

  return hideElement(elem);;
};

window.onload = changeLink();
