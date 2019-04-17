function validateForm() {
  const form = document.forms[0];
  const officeNameElement = form.elements.namedItem('office-name');
  const firstContactElement = form.elements.namedItem('user-phone-number');
  const firstContactDisplayNameElement = form.elements.namedItem('user-name');
  const firstContactEmailElement = form.elements.namedItem('user-email');
  const secondContactElement = form.elements.namedItem('second-contact-phone-number');
  const secondContactDisplayNameElement = form.elements.namedItem('second-contact-name');
  const secondContactEmailElement = form.elements.namedItem('second-contact-email');

  let valid = true;

  function getWarningNode(fieldName) {
    valid = false;

    const warningNode = document.createElement('span');
    warningNode.classList.add('warning-label');
    warningNode.textContent = `${fieldName} is required`;

    return warningNode;
  }

  if (!isNonEmptyString(officeNameElement.value)) {
    const element = getWarningNode('Office Name');

    insertAfterNode(officeNameElement, element);
  }

  if (!isNonEmptyString(firstContactElement.value)) {
    const element = getWarningNode('Your Phone Number');

    insertAfterNode(firstContactElement, element);
  }

  if (!isNonEmptyString(firstContactDisplayNameElement.value)) {
    const element = getWarningNode('Your name');

    insertAfterNode(firstContactDisplayNameElement, element);
  }

  if (!isNonEmptyString(firstContactEmailElement.value)) {
    const element = getWarningNode('Your Email');

    insertAfterNode(firstContactEmailElement, element);
  }

  if (!isNonEmptyString(secondContactElement.value)) {
    const element = getWarningNode('Second Contact');

    insertAfterNode(secondContactElement, element);
  }

  if (!isNonEmptyString(secondContactDisplayNameElement.value)) {
    const element = getWarningNode('Second Contact Name');

    insertAfterNode(secondContactDisplayNameElement, element);
  }

  if (!isNonEmptyString(secondContactEmailElement.value)) {
    const element = getWarningNode('Second Contact Email');

    insertAfterNode(secondContactEmailElement, element);
  }

  return {
    valid,
    values: {
      officeName: officeNameElement.value,
      firstContactPhoneNumber: firstContactElement.value,
      secondContactElementPhoneNumber: secondContactElement.value,
      firstContactDisplayName: firstContactDisplayNameElement.value,
      secondContactDisplayName: secondContactDisplayNameElement.value,
      firstContactEmail: firstContactEmailElement.value,
      secondContactEmail: secondContactElement.value,
    },
  }
}

function sendOfficeCreationRequest(values) {

};

function startOfficeCreationFlow() {
  const result = validateForm();

  if (!result.valid) return;

  uiConfig
    .defaultNationalNumber = document
      .forms[0]
      .elements
      .namedItem('user-phone-number')
      .value;

  /** Not logged-in */
  if (!firebase.auth().currentUser) {
    const fbUiElem = document.createElement('div');
    fbUiElem.id = 'firebaseui-auth-container';

    document.body.appendChild(fbUiElem);

    ui.start('#firebaseui-auth-container', uiConfig);

    return;
  }


  return sendOfficeCreationRequest(result.values);
}

document.addEventListener('click', (event) => {
  event.preventDefault();

  if (event.target === document.getElementById('form-submit-button')) {
    startOfficeCreationFlow()
  }
});
