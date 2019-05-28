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

function handleProductClick(elem) {
  console.log('elem:', elem);

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
    }).catch(function (error) {
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
