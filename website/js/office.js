// needs to be global for gMaps to work. // See docs.
let map;
let player;

function initMap(location, populateWithMarkers) {
  const curr = {
    lat: location.latitude,
    lng: location.longitude
  };

  document.getElementById('map').style.height = '400px';
  document.getElementById('load-map-button').style.display = 'none';

  map = new google.maps.Map(
    document.getElementById('map'), {
      zoom: 16,
      center: curr,
    }
  );

  const marker = new google.maps.Marker({
    position: curr,
    map
  });

  if (!populateWithMarkers) return;

  const allLis = document.querySelectorAll('.branch-list-container li');
  const bounds = new google.maps.LatLngBounds();

  if (allLis && allLis.length > 0) {
    allLis.forEach(function (item) {
      const marker = new google.maps.Marker({
        position: {
          lat: Number(item.dataset.latitude),
          lng: Number(item.dataset.longitude),
        },
        map
      });

      bounds.extend(marker.getPosition());
    });

    map.fitBounds(bounds);
  }
}

function handleProductClick(elem) {
  const detailsContainer = elem
    .querySelector('.product-details-container');

  /** Only shows the details when some detail is present */
  if (detailsContainer.querySelector('.product-details-container ul').childElementCount) {
    detailsContainer
      .classList
      .toggle('hidden');
  }
};

function handleBranchClick(latitude, longitude) {
  const position = {
    lat: Number(latitude),
    lng: Number(longitude),
  };

  if (latitude && longitude) {
    new google.maps.Marker({
      position,
      map
    });

    map.setCenter(position);
  }
}

function updateMapPointer(event) {
  initMap({
    latitude: Number(event.target.dataset.latitude),
    longitude: Number(event.target.dataset.longitude)
  })
}

function validateEnquiryForm() {
  const enquiryText = document.getElementsByName('enquiry-text');
  const productSelect = document.getElementsByName('product-select')[0];

  let valid = true;

  if (!isNonEmptyString(enquiryText[0].value)) {
    valid = false;
    const node = getWarningNode('The Enquiry Text is required');

    insertAfterNode(enquiryText[0], node);
  }

  return {
    valid,
    values: {
      enquiryText: enquiryText[0].value,
      productName: productSelect ? productSelect.value : '',
    },
  }
}

function startEnquiryCreationFlow() {
  const oldWarningLabels = document.querySelectorAll('p .warning-label');
  Array
    .from(oldWarningLabels)
    .forEach(function (element) {
      element.parentNode.removeChild(element);
    });

  const result = validateEnquiryForm();

  if (!result.valid) return;

  if (!firebase.auth().currentUser) {
    const enquiryText = result.values.enquiryText;
    const productName = result.values.productName;

    console.log('form stored to localstorage');

    if (enquiryText) {
      localStorage.setItem('enquiryText', enquiryText);
    }

    if (productName) {
      localStorage.setItem('productName', productName);
    }

    window.location.href = `/auth?redirect_to=${window.location.href}`;

    return;
  }

  const spinner = getSpinnerElement('enquiry-fetch-spinner').default();
  document.forms[0].innerText = '';
  document.forms[0].style.display = 'flex';
  document.forms[0].style.justifyContent = 'center';
  document.forms[0].appendChild(spinner);

  getLocation()
    .then(function (location) {
      const requestBody = {
        office: document.body.dataset.slug,
        timestamp: Date.now(),
        template: 'enquiry',
        geopoint: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          provider: 'HTML5',
        },
        share: [],
        schedule: [],
        venue: [],
        attachment: {
          'Company Name': {
            type: 'string',
            value: document.body.dataset.slug,
          },
          Product: {
            value: result.values.productName,
            type: 'product',
          },
          'Enquiry': {
            value: result.values.enquiryText,
            type: 'string',
          }
        }
      }

      sendApiRequest(
        `${apiBaseUrl}/activities/create`,
        requestBody,
        'POST'
      )
        .then(function (result) {
          return result.json();
        })
        .then(function (response) {
          console.log('Response', response);

          if (localStorage.getItem('enquiryText')) {
            localStorage.removeItem('enquiryText');
          }

          if (localStorage.getItem('productName')) {
            localStorage.removeItem('productName');
          }

          document
            .getElementById('enquiry-fetch-spinner')
            .style.display = 'none';

          const span = document.createElement('span');
          let spanText = 'Enquiry sent successfully';

          if (!response.success) {
            spanText = response.message;
            span.classList.add('warning-label');
          } else {
            span.classList.add('success-label');
          }

          span.innerHTML = spanText;
          document.forms[0].appendChild(span);

          return;
        });
    })
    .catch(function (error) {
      if (error === 'Please Enable Location') {
        const spinner = document.getElementById('enquiry-fetch-spinner');
        spinner.classList.add('hidden');

        const form = document.forms[0];
        const warningP = document.createElement('p');
        warningP.classList.add('warning-label');
        warningP.innerText = 'Location access is required';
        form.appendChild(warningP);

        return;
      }

      console.error(error);
    })
};

window.onload = function () {
  if (localStorage.getItem('enquiryText')) {
    console.log('setting enquiryText from localstorage');

    document
      .getElementById('enquiry-text')
      .value = localStorage.getItem('enquiryText');
  }

  if (localStorage.getItem('productName')) {
    console.log('setting productName from localstorage');

    document
      .getElementById('product-select')
      .value = localStorage.getItem('productName');
  }
}

function isElementVisible(el) {
  var rect = el.getBoundingClientRect(),
    vWidth = window.innerWidth || doc.documentElement.clientWidth,
    vHeight = window.innerHeight || doc.documentElement.clientHeight,
    efp = function (x, y) { return document.elementFromPoint(x, y) };

  // Return false if it's not in the viewport
  if (rect.right < 0 || rect.bottom < 0
    || rect.left > vWidth || rect.top > vHeight)
    return false;

  // Return true if any of its four corners are visible
  return (
    el.contains(efp(rect.left, rect.top))
    || el.contains(efp(rect.right, rect.top))
    || el.contains(efp(rect.right, rect.bottom))
    || el.contains(efp(rect.left, rect.bottom))
  );
}


const branchSecton = document.querySelector('.branch-section');

function startMapsFlow() {

  /** Not all offices have branches */
  if (!branchSecton
    /** Only when branch section is in the viewport */
    || !isElementVisible(branchSecton)
    /** No not bug the user for permission repetedly. */
    || window.askedForLocationAlready) {
    return;
  }

  return navigator
    .permissions
    .query({ name: 'geolocation' })
    .then(function (status) {
      window.askedForLocationAlready = true;

      if (status === 'granted') return null;

      return getLocation();
    })
    .then(function (result) {
      document.querySelector('#load-map-button').classList.add('hidden');

      return initMap(result, true);
    })
    .catch(function (error) {
      // window.askedForLocationAlready = false;
      const placeholderDiv = document.getElementById('load-map-button');
      placeholderDiv.classList.remove('hidden');
      document.querySelector('#load-map-button').classList.remove('hidden');

      console.warn('Location access denied', error);
    });
}

document.onscroll = startMapsFlow;

const retryButton = document.getElementById('retry-location-button');

if (retryButton) {
  retryButton.onclick = function (evt) {
    evt.preventDefault();
    console.log('Location Button clicked');

    startMapsFlow();
  };
}

function onPlayerReady(event) {
  console.log('onPlayerReady', event);
}

function onPlayerStateChange(event) {
  const STATUS = event.data;
  const ENDED = YT.PlayerState.ENDED;
  const PAUSED = YT.PlayerState.PAUSED;
  const PLAYING = YT.PlayerState.PLAYING;

  console.log('onPlayerStateChange', STATUS);

  function handleVideoEnded() {
    document.querySelector('.enquiry-section').scrollIntoView({
      behavior: 'smooth',
    });
  }

  function handleVideoPaused() { }
  function handleVideoPlaying() { }

  switch (STATUS) {
    case ENDED:
      handleVideoEnded();
      break;
    case PAUSED:
      handleVideoPaused();
      break;
    case PLAYING:
      handleVideoPlaying();
      break;
    default:
      console.log('Whooooo');
  };
}

function stopVideo() {
  player.stopVideo();
}


function onYouTubeIframeAPIReady() {
  console.log('onYouTubeIframeAPIReady');

  player = new YT.Player('ytplayer', {
    videoId: document.body.dataset.videId,
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange
    }
  });
}
