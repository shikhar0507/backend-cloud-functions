function validateForm() {
  const form = document.forms[0];
  const officeNameElement = form.elements.namedItem('office-name');
  const secondContactDisplayNameElement = form.elements.namedItem('second-contact-name');
  const secondContactEmailElement = form.elements.namedItem('second-contact-email');

  const secondContactElement = form.elements.namedItem('second-contact-phone-number');
  const secondContactPhoneNumber = getPhoneNumber('second-contact-phone-number');
  let valid = true;

  if (!isNonEmptyString(officeNameElement.value)) {
    const element = getWarningNode('Office Name is required');
    valid = false;

    insertAfterNode(officeNameElement, element);
  }

  if (!isNonEmptyString(secondContactElement.value)) {
    valid = false;
    const element = getWarningNode('Second contact is required');

    insertAfterNode(secondContactElement, element);
  }

  if (secondContactPhoneNumber
    && !isValidPhoneNumber(secondContactPhoneNumber)) {
    valid = false;
    const element = getWarningNode('Invalid phone number');

    insertAfterNode(secondContactElement, element);
  }

  if (!isNonEmptyString(secondContactDisplayNameElement.value)) {
    valid = false;
    const element = getWarningNode('Second Contact\'s Name is required');

    insertAfterNode(secondContactDisplayNameElement, element);
  }

  if (!isNonEmptyString(secondContactEmailElement.value)) {
    valid = false;
    const element = getWarningNode('Second Contact\'s email is required');

    insertAfterNode(secondContactEmailElement, element);
  }

  if (secondContactEmailElement.value
    && !isValidEmail(secondContactEmailElement.value)) {
    valid = false;
    const element = getWarningNode('Invalid email');

    insertAfterNode(secondContactEmailElement, element);
  }

  return {
    valid,
    values: {
      officeName: officeNameElement.value,
      secondContactPhoneNumber: secondContactPhoneNumber,
      secondContactDisplayName: secondContactDisplayNameElement.value,
      secondContactEmail: secondContactElement.value,
    },
  }
}

function sendOfficeCreationRequest(values) {
  console.log('creating office');

  const spinner = getSpinnerElement('join-fetch-spinner').default();
  const form = document.forms[0];
  form.innerText = '';
  form.classList.add('flexed', 'flexed-jc-center');

  form.appendChild(spinner);

  getLocation()
    .then(function (location) {
      const requestBody = {
        timestamp: Date.now(),
        office: values.officeName,
        template: 'office',
        geopoint: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
        data: [{
          share: [],
          Name: values.officeName,
          Description: '',
          'Youtube ID': '',
          'GST Number': '',
          'First Contact': firebase.auth().currentUser.phoneNumber,
          'Second Contact': values.secondContactPhoneNumber,
          Timezone: moment.tz.guess(),
          'Head Office': '',
          'Date Of Establishment': '',
          'Trial Period': '',
        }],
      }

      const idToken = getParsedCookies().__session;
      const requestUrl = `${apiBaseUrl}/bulk`;

      return fetch(requestUrl, {
        mode: 'cors',
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
      })
        .then(function (result) {
          if (!result.ok && sessionStorage.getItem('prefill-form')) {
            sessionStorage.removeItem('prefill-form');
          }

          return result.json();
        })
        .then(function (response) {
          console.log('Response', response);

          document
            .getElementById('join-fetch-spinner')
            .style.display = 'none';

          const span = document.createElement('span');

          let spanText = 'Office Created Successfully';

          if (!response.success) {
            spanText = response.message;
            span.classList.add('warning-label');
          } else {
            span.classList.add('success-label');
          }

          span.innerHTML = spanText;
          form.appendChild(span);

          // redirect to the home page
          return;
        });
    })
    .catch(console.error)
};

function startOfficeCreationFlow(event) {
  event.preventDefault();

  const oldWarningLabels = document.querySelectorAll('p .warning-label');

  Array
    .from(oldWarningLabels)
    .forEach((element) => {
      element.style.display = 'none';
    });

  const result = validateForm();

  console.log('result', result);

  if (!result.valid) return;

  /** Not logged-in */
  if (!firebase.auth().currentUser) {
    window.location.href = `/auth?redirect_to=${window.location.href}`;

    return;
  }

  return sendOfficeCreationRequest(result.values);
}

document.addEventListener('onbeforeunload', function () {
  console.log('saving form data to sessionstorage');

  const form = document.forms[0];
  const officeNameElement = form.elements.namedItem('office-name');
  const secondContactElement = form.elements.namedItem('second-contact-phone-number');
  const secondContactDisplayNameElement = form.elements.namedItem('second-contact-name');
  const secondContactEmailElement = form.elements.namedItem('second-contact-email');

  sessionStorage
    .setItem('prefill-form', JSON.stringify({
      officeName: officeNameElement.value,
      secondContact: secondContactElement.value,
      secondContactDisplayName: secondContactDisplayNameElement.value,
      secondContactEmail: secondContactEmailElement.value,
    }));
});

window.onload = function () {
  if (sessionStorage.getItem('prefill-form')) {
    const formData = JSON.parse(sessionStorage.getItem('prefill-form'));

    const form = document.forms[0];
    form.elements.namedItem('office-name').value = formData.officeName;
    form.elements.namedItem('second-contact-phone-number').value = formData.secondContact;
    form.elements.namedItem('second-contact-name').value = formData.secondContactDisplayName;
    form.elements.namedItem('second-contact-email').value = formData.secondContactEmail;
    const form2 = document.getElementById('form-2');

    form2.classList.remove('hidden');

    return;
  }
}

// const officeInput = document.getElementById('office-name');

// officeInput.
// officeInput.oninput = function (evt) {
//   const form2 = document.getElementById('form-2');
//   const inputValue = evt.target.value;

//   if (!inputValue) {
//     form2.classList.add('hidden');
//     // helpText.innerText = 'Enter Your Office Name';

//     return;
//   }

//   form2.classList.remove('hidden');
// }

// officeInput.onblur = function (evt) {
//   console.log('Focus lost', evt.target.value);
// }

// second-contact-phone-number
window.intlTelInput(document.querySelector('#second-contact-phone-number'), {
  preferredCountries: ['IN'],
  initialCountry: 'IN',
  // nationalMode: false,
  separateDialCode: true,
  // formatOnDisplay: true,
  autoHideDialCode: true,
  customPlaceholder: function (selectedCountryPlaceholder, selectedCountryData) {
    window.countryCode = selectedCountryData.dialCode;
    console.log({ selectedCountryPlaceholder, selectedCountryData });
    return "e.g. " + selectedCountryPlaceholder;
  }
});
