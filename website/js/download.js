function getMobileOperatingSystem() {
  var userAgent = navigator.userAgent || navigator.vendor || window.opera;

  // Windows Phone must come first because its UA also contains "Android"
  if (/windows phone/i.test(userAgent)) {
    return 'Windows Phone';
  }

  if (/android/i.test(userAgent)) {
    return 'Android';
  }

  // iOS detection from: http://stackoverflow.com/a/9039885/177710
  if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
    return 'iOS';
  }

  return 'unknown';
};

function hideElement(element) {
  if (!element) return;

  element.style.display = 'none';
}


function detectAndHideLinks() {
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

window.onload = detectAndHideLinks();
