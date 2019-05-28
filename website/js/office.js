// needs to be global for gMaps to work. // See docs.
let map;

function initMap(location) {
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
      productName: document.getElementsByName('product-select')[0].value,
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

    localStorage.setItem('enquiryText', enquiryText);
    localStorage.setItem('productName', productName);

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
        });
    }).catch(console.error)
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
