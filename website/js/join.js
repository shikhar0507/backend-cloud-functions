(function () {
  if (!sessionStorage.getItem('prefill-form')) {
    return;
  }

  const {
    officeName,
    firstContact,
    firstContactDisplayName,
    firstContactEmail,
    secondContact,
    secondContactDisplayName,
    secondContactEmail,
  } = JSON.parse(sessionStorage.getItem('prefill-form'));

  if (officeName) {
    form.elements.namedItem('office-name').value = officeName;
  }

  if (firstContact) {
    form.elements.namedItem('user-phone-number').value = firstContact;
  }

  if (firstContactDisplayName) {
    form.elements.namedItem('user-name').value = firstContactDisplayName;
  }

  if (firstContactEmailElement) {
    form.elements.namedItem('user-email').value = firstContactEmailElement
  }

  if (secondContactElement) {
    form.elements.namedItem('second-contact-phone-number').value = secondContactElement;
  }

  if (secondContactDisplayNameElement) {
    form.elements.namedItem('second-contact-name').value = secondContactDisplayNameElement;
  }

  if (secondContactEmailElement) {
    form.elements.namedItem('second-contact-email').value = secondContactEmailElement;
  }
})();


function validateForm() {
  const form = document.forms[0];
  const officeNameElement = form.elements.namedItem('office-name');
  const firstContactElement = form.elements.namedItem('user-phone-number');
  const secondContactElement = form.elements.namedItem('second-contact-phone-number');
  const secondContactDisplayNameElement = form.elements.namedItem('second-contact-name');
  const secondContactEmailElement = form.elements.namedItem('second-contact-email');

  let valid = true;

  if (!isNonEmptyString(firstContactElement.value)) {
    valid = false;
    const element = getWarningNode('First contact is required');

    insertAfterNode(firstContactElement, element);
  }

  if (firstContactElement.value
    && !isValidPhoneNumber(firstContactElement.value)) {
    valid = false;
    const element = getWarningNode('Invalid phone number');

    insertAfterNode(firstContactElement, element);
  }

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

  if (!isValidPhoneNumber(secondContactElement.value)) {
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

  if (!isValidEmail(secondContactEmailElement.value)) {
    valid = false;
    const element = getWarningNode('Invalid email');

    insertAfterNode(secondContactEmailElement, element);
  }

  return {
    valid,
    values: {
      officeName: officeNameElement.value,
      secondContactPhoneNumber: secondContactElement.value,
      secondContactDisplayName: secondContactDisplayNameElement.value,
      secondContactEmail: secondContactElement.value,
    },
  }
}

function sendOfficeCreationRequest(values) {
  console.log('creating office');

  const spinner = getSpinnerElement().default();
  document.forms[0].innerText = '';
  document.forms[0].style.display = 'flex';
  document.forms[0].style.justifyContent = 'center';

  spinner.id = 'join-fetch-spinner';

  document.forms[0].appendChild(spinner);

  getLocation().then(function (location) {
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
    const requestUrl = 'https://api2.growthfile.com/api/admin/bulk?support=true';

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
        document.forms[0].appendChild(span);

        // redirect to the home page
        return;
      });
  }).catch(console.error)
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
  const firstContactElement = form.elements.namedItem('user-phone-number');
  // const firstContactDisplayNameElement = form.elements.namedItem('user-name');
  // const firstContactEmailElement = form.elements.namedItem('user-email');
  const secondContactElement = form.elements.namedItem('second-contact-phone-number');
  const secondContactDisplayNameElement = form.elements.namedItem('second-contact-name');
  const secondContactEmailElement = form.elements.namedItem('second-contact-email');

  sessionStorage
    .setItem('prefill-form', JSON.stringify({
      officeName: officeNameElement.value,
      firstContact: firstContactElement.value,
      // firstContactDisplayName: firstContactDisplayNameElement.value,
      // firstContactEmail: firstContactEmailElement.value,
      secondContact: secondContactElement.value,
      secondContactDisplayName: secondContactDisplayNameElement.value,
      secondContactEmail: secondContactEmailElement.value,
    }));
});
