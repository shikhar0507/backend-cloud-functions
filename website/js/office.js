// needs to be global for gMaps to work. // See docs.
let map;
let firebaseAuthModal;

function initMap(latitude, longitude) {
  const curr = { lat: latitude, lng: longitude };

  document.getElementById('map').style.height = '400px';
  document.getElementById('load-map-button').style.display = 'none';

  map = new google.maps.Map(
    document.getElementById('map'), {
      zoom: 16,
      center: curr,
    }
  );

  const marker = new google.maps.Marker({ position: curr, map });
}

function handleProductClick(param) {
  console.log(param);

  const html = `
  <div class="pico-product-details">
    <h2>${param.name}</h2>
    <img src="${param.imageUrl}">
    <p>Brand: ${param.brand}</p>
    <p>Model: ${param.model}</p>
    <p>Type: ${param.productType}</p>
    <p>Size: ${param.size}</p>
</div>`;

  const modal = picoModal(html);

  modal.show();
};

function handleBranchClick(latitude, longitude) {
  const position = {
    lat: Number(latitude),
    lng: Number(longitude),
  };

  if (latitude && longitude) {
    const marker = new google.maps.Marker({ position, map });

    map.setCenter(position);
  }
}

function updateMapPointer(event) {
  initMap(
    Number(event.target.dataset.latitude),
    Number(event.target.dataset.longitude)
  );
}

function validateForm() {
  const userName = document.getElementsByName('user-display-name');
  const email = document.getElementsByName('user-email');
  const phoneNumber = document.getElementsByName('user-phone-number');
  const enquiryText = document.getElementsByName('enquiry-text');

  let valid = true;

  if (!isNonEmptyString(userName[0].value)) {
    valid = false;
    const node = getWarningNode('Your Name');

    insertAfterNode(userName[0], node);
  }

  if (!isNonEmptyString(email[0].value)) {
    valid = false;
    const node = getWarningNode('Your Email');

    insertAfterNode(email[0], node);
  }

  if (!isNonEmptyString(phoneNumber[0].value)) {
    valid = false;
    const node = getWarningNode('You Contact');

    insertAfterNode(phoneNumber[0], node);
  }

  if (!isNonEmptyString(enquiryText[0].value)) {
    valid = false;
    const node = getWarningNode('The Enquiry Text');

    insertAfterNode(enquiryText[0], node);
  }

  return {
    values: {
      email: email[0].value,
      displayName: userName[0].value,
      phoneNumber: phoneNumber[0].value,
      enquiryText: enquiryText[0].value,
      productName: document.getElementsByName('product-select')[0].value,
    },
    valid,
  }
}

function startEnquiryCreationFlow(event) {
  event.preventDefault();

  const oldWarningLabels = document.querySelectorAll('p .warning-label');

  Array
    .from(oldWarningLabels)
    .forEach((element) => element.style.display = 'none');

  const result = validateForm();

  if (!result.valid) return;

  if (!firebase.auth().currentUser) {
    const modal = showLoginBox('90%', 'fb-login-box');

    modal.show();

    return;
  }

  if (!startPosition) {
    console.log('trying to ask permission');

    return askLocationPermission(null, startEnquiryCreationFlow);
  }

  const spinner = getSpinnerElement();
  document.forms[0].innerText = '';
  document.forms[0].style.display = 'flex';
  document.forms[0].style.justifyContent = 'center';

  spinner.id = 'enquiry-fetch-spinner';

  document.forms[0].appendChild(spinner);

  const requestBody = {
    office: document.body.dataset.slug,
    timestamp: Date.now(),
    template: 'enquiry',
    geopoint: {
      latitude: startPosition.coords.latitude,
      longitude: startPosition.coords.longitude,
      accuracy: startPosition.accuracy,
      provide: 'HTML5',
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

  const idToken = getParsedCookies().__session;

  // const requestUrl = 'https://api2.growthfile.com/api/activities/create';
  const requestUrl = 'https://us-central1-growthfilev2-0.cloudfunctions.net/api/activities/create';

  console.log('sending fetch request', requestBody);

  return fetch(requestUrl, {
    mode: 'cors',
    method: 'POST',
    body: JSON.stringify(requestBody),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
  })
    .then((result) => result.json())
    .then((response) => {
      console.log('Response', response);

      document
        .getElementById('enquiry-fetch-spinner')
        .style.display = 'none';

      const span = document.createElement('span');
      let spanText = 'Enquiry sent :)';

      if (!response.success) {
        spanText = response.message;
        span.classList.add('success-label');
      } else {
        span.classList.add('warning-label');
      }

      span.innerHTML = spanText;
      document.forms[0].appendChild(span);

      return;
    })
    .catch(console.error);
};
