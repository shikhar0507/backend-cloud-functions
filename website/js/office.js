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
    const node = getWarningNode('Your Name is required');

    insertAfterNode(userName[0], node);
  }

  if (!isNonEmptyString(email[0].value)) {
    valid = false;
    const node = getWarningNode('Your Email is required');

    insertAfterNode(email[0], node);
  }

  if (!/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(email[0].value)) {
    valid = false;
    const node = getWarningNode('Doesn\'t look like a valid email.');

    insertAfterNode(email[0], node);
  }

  if (!isNonEmptyString(phoneNumber[0].value)) {
    valid = false;
    const node = getWarningNode('You Contact is required');

    insertAfterNode(phoneNumber[0], node);
  }

  if (!/^\+[1-9]\d{5,14}$/.test(phoneNumber[0].value)) {
    valid = false;
    const node = getWarningNode('Doesn\'t look like a valid phone number');

    insertAfterNode(phoneNumber[0], node);
  }

  if (!isNonEmptyString(enquiryText[0].value)) {
    valid = false;
    const node = getWarningNode('The Enquiry Text is required');

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

function startEnquiryCreationFlow() {
  const oldWarningLabels = document.querySelectorAll('p .warning-label');
  Array
    .from(oldWarningLabels)
    .forEach((element) => element.style.display = 'none');

  const result = validateForm();

  if (!result.valid) return;

  if (!firebase.auth().currentUser) {
    window.location.href = `/auth?redirect_to=${window.location.href}`;
    return;
  }


  const spinner = getSpinnerElement();
  document.forms[0].innerText = '';
  document.forms[0].style.display = 'flex';
  document.forms[0].style.justifyContent = 'center';
  spinner.id = 'enquiry-fetch-spinner';
  document.forms[0].appendChild(spinner);

  getLocation().then(function(location){
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
  
    const idToken = getParsedCookies().__session;
    const requestUrl = 'https://api2.growthfile.com/api/activities/create';
  
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
          span.classList.add('warning-label');
        } else {
          span.classList.add('success-label');
        }
  
        span.innerHTML = spanText;
        document.forms[0].appendChild(span);
  
        return;
      })
      .catch(console.error);    
  }).catch(console.error)

};
