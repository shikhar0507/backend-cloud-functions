'use strict';

function showActions() {
  document
    .querySelector('#actions-section')
    .classList
    .remove('hidden');
}

function hideActions() {
  document
    .querySelector('#actions-section')
    .classList
    .add('hidden');
}

function setBreadcrumb(action) {
  const ul = document.querySelector('.breadcrumbs ul');

  while (ul.firstChild) {
    ul.firstChild.remove();
  }

  const home = document.createElement('li');
  const homeA = document.createElement('a');

  homeA.textContent = document.body.dataset.office || 'Home';
  homeA.href = '#';
  homeA.onclick = function (evt) {
    evt.preventDefault();

    showActions();

    document
      .querySelector('.hero-actions')
      .classList.add('hidden');

    setBreadcrumb(null);
  }

  home.appendChild(homeA);
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.textContent = action;
  a.href = '#';

  /** Do nothing since this path is open already for the user */
  a.onclick = function (evt) { evt.preventDefault() };

  li.appendChild(a);
  ul.append(home);

  if (action) {
    ul.appendChild(li);
  }
}


function setActionTitle(text) {
  document.querySelector('.action-title')
    .textContent = text || 'My Growthfile';

  if (text) setBreadcrumb(text);
}

const intlTelInputOptions = {
  preferredCountries: ['IN', 'NP'],
  initialCountry: 'IN',
  nationalMode: false,
  formatOnDisplay: true,
  customContainer: 'mb-16',
  separateDialCode: true,
  customPlaceholder: function (selectedCountryPlaceholder, selectedCountryData) {
    window.countryCode = selectedCountryData.dialCode;
    console.log({ selectedCountryPlaceholder, selectedCountryData });
    return "e.g. " + selectedCountryPlaceholder;
  }
};

Object.freeze(intlTelInputOptions);

function handleTopSelectTemplateClick(evt) {
  console.log('handleTopSelectTemplateClick', evt);
}

function allOfficeSelectOnChange() {
  const officeSelect = document.querySelector('#all-office-form select');
  const office = officeSelect.options[officeSelect.selectedIndex].value;
  document.body.dataset.office = office;

  const supportSearch = document.querySelector('#support-office-search');

  supportSearch.remove();

  // document
  //   .querySelector('#actions-section')
  //   .classList
  //   .remove('hidden');
  showActions();
  setBreadcrumb(null);
}

function fetchOfficeList() {
  const officeSelect = document.querySelector('#all-office-form select');
  // This element has value => 'Loading...'
  officeSelect.firstElementChild.remove();

  const placeholder = document.createElement('option');
  placeholder.textContent = 'Select an office';
  officeSelect.appendChild(placeholder);

  function populateOfficeInSelect(names) {
    names.forEach(function (name) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;

      officeSelect.appendChild(option);
    });
  }

  officeSelect.onchange = allOfficeSelectOnChange;

  const cachedList = sessionStorage.getItem('officeNamesList');
  if (cachedList) {
    console.log('office list from cached');

    populateOfficeInSelect(cachedList.split(','));

    return;
  }

  console.log('Request sent action=office-list');

  sendApiRequest('/json?action=office-list')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('response', response);
      sessionStorage.setItem('officeNamesList', response);

      populateOfficeInSelect(response);
    })
    .catch(console.error);
}


function setTemplatesInTopSelect() {
  const selectElement = document.querySelector('.top-templates-select');

  sendApiRequest('/json?action=get-template-names')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('Response', response);

      selectElement.querySelector('optgroup').remove();

      response.forEach(function (name) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;

        selectElement.appendChild(option);
      });

      selectElement.onchange = handleTopSelectTemplateClick;
    })
    .catch(console.error);
};

function startAdmin() {
  document.body.dataset.office = document.getElementById('office-selector').value;

  // Hide the section containing the office select
  document
    .getElementById('office-form')
    .parentElement
    .classList
    .add('hidden');

  showActions();
}


function triggerReports() {
  setActionTitle('Trigger Reports');

  let startTime = Date.now();
  const dateInput = document.querySelector('#report-trigger-date');

  document
    .querySelector('#trigger-reports-section')
    .classList
    .remove('hidden');
  dateInput.valueAsDate = new Date();

  dateInput.onchange = function (evt) {
    startTime = evt.target.value;
  }

  const triggerResult = document.querySelector('#trigger-report-result');

  function recipientSubmitOnClick() {
    startTime = new Date(startTime).getTime();

    console.log({ startTime });

    sendApiRequest(`${apiBaseUrl}/admin/trigger-report`, {
      startTime,
      office: document.body.dataset.office,
      report: document.querySelector('#report-trigger-select').value,
      endTime: startTime,
    }, 'POST')
      .then(function (response) { return response.json(); })
      .then(function (response) {
        if (!response.success) {
          triggerResult.classList.add('warning-label');
        }

        triggerResult.classList.remove('hidden');
        triggerResult.textContent = response.message
          || 'Report triggered successfully';

        console.log('Response', response);
      })
      .catch(console.error);
  }

  sendApiRequest(`/json?template=recipient&office=${document.body.dataset.office}`, null, 'GET')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      const selectBox = document.querySelector('#report-trigger-select');

      console.log('response', response);

      Object
        .keys(response)
        .forEach(function (activityId) {
          const item = response[activityId];
          const option = document.createElement('option')
          option.value = item.attachment.Name.value;
          option.textContent = item.attachment.Name.value;
          selectBox.appendChild(option);
        });

      const submitButton = document.querySelector('#trigger-report-button');

      submitButton.onclick = recipientSubmitOnClick;
    })
    .catch(console.error);
}

function getEnquiryLi(record, index) {
  const li = document.createElement('li');
  const spanContainer = document.createElement('span');
  const primaryText = document.createElement('span');
  const secondaryText = document.createElement('span');

  li.classList.add('mdc-list-item');

  if (index === 0) {
    li.setAttribute('tabindex', 0);
  }

  spanContainer.classList.add('mdc-list-item__text');
  spanContainer.style.pointerEvents = 'none';
  primaryText.classList.add('mdc-list-item__primary-text');
  secondaryText.classList.add('mdc-list-item__secondary-text');

  primaryText.textContent = record.attachment.Enquiry.value;
  secondaryText.textContent = (function () {
    if (firebase.auth().currentUser === record.creator.phoneNumber) {
      return 'You';
    }

    return `${record.creator.displayName} (${record.creator.phoneNumber})`;
  })();

  spanContainer.appendChild(primaryText);
  spanContainer.appendChild(secondaryText);

  li.appendChild(spanContainer);

  return li;
};

function handlePhoneNumberChange(options) {
  const container = options.container;

  const requestBody = {
    oldPhoneNumber: options.oldInput.value,
    newPhoneNumber: options.newInput.value,
    office: document.body.dataset.office,
  };

  let requestUrl = `${apiBaseUrl}/admin/change-phone-number`;

  if (document.body.dataset.issupport) {
    requestUrl += '?support=true';
  }

  const sucessLabel = container.querySelector('.success-label');
  const errorLabel = container.querySelector('.warning-label');

  errorLabel.textContent = '';

  sendApiRequest(requestUrl, requestBody, 'POST')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      if (!response.success) {
        errorLabel.classList.remove('hidden');
        errorLabel.textContent = response.message;

        return;
      }

      sucessLabel.classList.remove('hidden');
    })
    .catch(console.error);
}

function changePhoneNumber() {
  setActionTitle('Change Phone Number');

  const container = document.querySelector('.pnc-container');
  const oldInput = container.querySelector('input[data-old="true"]');
  const newInput = container.querySelector('input[data-new="true"]');

  oldInput.style.width = '100%';
  oldInput.style.height = '52px';

  window.intlTelInput(oldInput, intlTelInputOptions);

  newInput.style.width = '100%';
  newInput.style.height = '52px';

  window.intlTelInput(newInput, intlTelInputOptions);

  container.classList.remove('hidden');

  const submitButton = container.querySelector('input[type="button"]')

  submitButton.onclick = function () {
    handlePhoneNumberChange({
      container,
      oldInput,
      newInput
    });
  };
};


function searchBar(id) {
  const conatiner = document.createElement('div')
  const input = document.createElement('input')
  input.type = 'text';
  input.className = 'input-field';
  input.id = id;

  const button = document.createElement('button');
  button.className = 'button';
  button.textContent = 'Search'
  button.id = 'search'
  conatiner.appendChild(input)
  conatiner.appendChild(button)
  return conatiner;
}

function searchBarWithList(labelText, id) {
  const label = document.createElement('label')
  label.textContent = labelText;
  const ul = document.createElement("ul");
  ul.id = 'search-results'
  const baseSearchBar = searchBar(id);
  baseSearchBar.appendChild(label);
  baseSearchBar.appendChild(ul)
  return baseSearchBar

}

function handleUpdateAuthRequest() {
  const form = document.querySelector('.update-auth-form');
  const phoneNumber = form.querySelector('input[type="tel"]').value;
  const displayName = form.querySelector('input[data-displayName=true]').value;
  const email = form.querySelector('input[type="email"]').value;

  return sendApiRequest(
    `${apiBaseUrl}/update-auth`,
    {
      phoneNumber,
      displayName,
      email,
    },
    'POST'
  )
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('result', response);
      // api-result
      const p = form.querySelector('.api-result');
      p.parentElement.classList.remove('hidden');
      p.textContent = response.message;
    })
    .catch(console.error);
}

function updateAuth() {
  setActionTitle('Update Auth');

  console.log('Update auth called');
  const updateAuthContainer = document.querySelector('.update-auth');
  updateAuthContainer.classList.remove('hidden');
  const phoneInput = updateAuthContainer.querySelector('input[type="tel"]');

  phoneInput.style.width = '100%';
  phoneInput.style.height = '52px';

  window.intlTelInput(phoneInput, intlTelInputOptions);

  const submitButton = updateAuthContainer.querySelector('input[type="button"]');

  submitButton.onclick = handleUpdateAuthRequest;
}

function isValidJSON(json) {
  try {
    JSON.parse(json);

    return true;
  } catch (error) {
    console.log('error', error);
    return false;
  }
}

function updateTemplate(event) {
  event.preventDefault();

  document.querySelectorAll('p>.warning-label').forEach(function (item) {
    item.parentElement.removeChild(item);
  });

  const jsonTextarea = document.querySelector('#template-json');
  const templateJSON = document.querySelector('#template-json');

  const value = templateJSON.value;

  if (value.trim() === '') {
    const node = getWarningNode('Template cannot be empty');

    insertAfterNode(templateJSON, node);

    return;
  }

  if (!isValidJSON(value)) {
    const node = getWarningNode(`Doesn't look like valid json`);

    insertAfterNode(templateJSON, node);

    return;
  }

  const spinner = getSpinnerElement('template-update-spinner').default();
  const form = document.querySelector('#update-template-form');
  form.classList.add('wrap-content');

  console.log('Sending api request');

  return sendApiRequest('/json?action=update-template', JSON.parse(value), 'POST')
    .then(function (response) {
      console.log('response', response);

      return response.json();
    })
    .then(function (result) {
      console.log('result', result);

      spinner.classList.add('hidden');

      const node = getWarningNode(result.message);

      // green
      if (result.code < 299) {
        node.classList.add('success-label');

        // Template updated. Remove cached stuff.
        sessionStorage.removeItem('templatesJson');
      }

      insertAfterNode(jsonTextarea, node);
    })
    .catch(function (error) {
      console.error(error);
    });
}

function handleTemplateEditClick(event) {
  event.preventDefault();
  console.log(event.target.dataset);
  const templatesJSON = JSON.parse(sessionStorage.getItem('templatesJson'));

  console.log(templatesJSON[event.target.dataset.templateId]);
  const manageTemplatesAction = document.querySelector('#manage-templates-action');

  const form = document.createElement('form');
  form.id = 'update-template-form';
  form.autocomplete = 'off';
  form.classList.add('flexed-column', 'flexed-ai-center', 'pad');
  const textareaContainer = document.createElement('p');
  textareaContainer.classList.add('w-100');
  const submitContainer = document.createElement('p');
  const textarea = document.createElement('textarea');
  textarea.rows = 20;
  textarea.classList.add('input-field', 'w-100');
  textarea.placeholder = 'Enter template JSON here...';
  textarea.id = 'template-json';

  const submitButton = document.createElement('a');
  submitButton.href = '#';
  submitButton.classList.add('button');
  submitButton.innerText = 'Update';
  submitButton.onclick = updateTemplate;

  textarea.value = JSON.stringify(templatesJSON[event.target.dataset.templateId], ' ', 4);

  textareaContainer.appendChild(textarea);
  submitContainer.appendChild(submitButton);

  form.appendChild(textareaContainer);
  form.appendChild(submitContainer);

  // clear the old elements in the container;
  while (manageTemplatesAction.firstChild) {
    manageTemplatesAction.removeChild(manageTemplatesAction.firstChild);
  }

  manageTemplatesAction.appendChild(form);

  // Scroll the editor in to view.
  document
    .querySelector('#manage-template-container ul')
    .scrollIntoView({
      behavior: 'smooth',
    });
}

function showTemplateJSON(event) {
  console.log(event.target);
}

function populateTemplateList() {
  const manageTemplatesAction = document.querySelector('#manage-templates-action');
  console.log('request sent');

  function getListItem(templateObject, id) {
    const name = templateObject.name;
    const description = templateObject.comment;

    const li = document.createElement('li');
    // <i class="fas fa-pen"></i>
    const editIcon = document.createElement('i');
    editIcon.classList.add('fas', 'fa-pen', 'ml-8', 'cur-ptr');
    editIcon.dataset.templateId = id;
    const jsonContainer = document.createElement('pre');
    const descriptionSpan = document.createElement('span');
    const nameSpan = document.createElement('span');

    nameSpan.classList.add('bold', 'ttuc');
    descriptionSpan.classList.add('col-gray', 'mb-8');
    li.classList.add('flexed-column', 'border', 'pad', 'cur-ptr', 'mb-8');

    li.onclick = showTemplateJSON;

    nameSpan.innerText = name;

    editIcon.onclick = handleTemplateEditClick;

    nameSpan.appendChild(editIcon);
    descriptionSpan.innerText = description;

    jsonContainer.innerText = JSON.stringify(templateObject, ' ', 4);
    li.dataset.id = id;

    jsonContainer.classList.add('animated', 'fadeIn', 'border', 'pad', 'hidden');
    jsonContainer.style.overflowY = 'auto';

    li.appendChild(nameSpan);
    li.appendChild(descriptionSpan);
    li.appendChild(jsonContainer);

    return li;
  }

  const ul = document.createElement('ul');

  if (sessionStorage.getItem('templatesJson')) {
    document.querySelector('#spinner-container').classList.add('hidden');

    console.log('Skipped fetch');
    const json = JSON.parse(sessionStorage.getItem('templatesJson'));

    const items = Object.keys(json);

    items.forEach(function (id) {
      // console.log(id, json[id]);
      const li = getListItem(json[id], id);

      ul.appendChild(li);
    });

    manageTemplatesAction.appendChild(ul);

    document.querySelector('#manage-templates').onclick = function () { };

    document
      .querySelector('#manage-template-container ul')
      .scrollIntoView({
        behavior: 'smooth',
      });

    return;
  }

  return sendApiRequest(`/json?action=view-templates`)
    .then(function (response) {

      return response.json();
    })
    .then(function (json) {
      console.log('json', json);

      sessionStorage.setItem('templatesJson', JSON.stringify(json));

      const items = Object.keys(json);

      items.forEach(function (id) {
        const li = getListItem(json[id]);

        ul.appendChild(li);
      });

      document.querySelector('#spinner-container').classList.add('hidden');

      manageTemplatesAction.appendChild(ul);

      // clear storage to remove old data

      document
        .querySelector('#manage-templates')
        .onclick = function () { };

      document
        .querySelector('#manage-template-container ul')
        .scrollIntoView({
          behavior: 'smooth',
        });
    })
    .catch(console.error);
}

function manageTemplates() {
  const actionContainer = document.querySelector('#manage-template-container');

  actionContainer.classList.remove('hidden');
  const spinnerContainer = document.createElement('div');
  spinnerContainer.id = 'spinner-container';
  spinnerContainer.classList.add('flexed-jc-center', 'flexed-ai-center', 'pad');
  const spinner = getSpinnerElement('template-container-spinner').default();
  spinnerContainer.appendChild(spinner);

  actionContainer.appendChild(spinnerContainer);

  // async function
  populateTemplateList();
}

function handleTemplateCreate(elem) {
  elem.preventDefault();
}

function submitNewTemplate() {
  console.log('New Template submit clicked');

  const textArea = document.querySelector('#template-content');
  const isValid = isValidJSON(textArea.value);
  const resultNode = document.querySelector('#result');
  resultNode.classList.remove('hidden');

  console.log('textarea.value', textArea.value, isValid);

  if (!isNonEmptyString(textArea.value)) {
    resultNode.textContent = 'Please enter something';

    return;
  }

  if (!isValid) {
    resultNode.textContent = 'Invalid JSON';

    return;
  }

  resultNode.classList.add('success-label');
  resultNode.textContent = 'Sending request';

  sendApiRequest(`/json?action=create-template`, JSON.parse(textArea.value), 'POST')
    .then(function (response) {
      return response.json();
    })
    .then(function (result) {
      resultNode.textContent = result.message;

      if (!result.success) {
        resultNode.classList.remove('success-label');
      }
    })
    .catch(console.error);
}

function createNewTemplate() {
  const oldList = document.querySelector('#manage-templates-action ul');

  if (oldList) oldList.remove();

  const oldForm = document.querySelector('#manage-templates-action form');

  if (oldForm) oldForm.remove();

  const textarea = document.createElement('textarea');
  textarea.id = 'template-content';
  textarea.classList.add('input-field', 'mb-16');
  textarea.style.minWidth = '90%';
  textarea.rows = '20';

  const button = document.createElement('button');
  button.classList.add('mdc-button');
  const buttonContent = document.createElement('span');
  buttonContent.classList.add('mdc-button__label');
  buttonContent.textContent = 'Submit';
  button.appendChild(buttonContent);
  button.onclick = submitNewTemplate;

  const messageNode = getWarningNode();

  messageNode.id = 'result';
  messageNode.classList.add('hidden');

  const form = document.createElement('form');
  form.appendChild(textarea);
  form.appendChild(messageNode)
  form.appendChild(button);

  form.onsubmit = handleTemplateCreate;

  form.classList.add('pad', 'flexed-column', 'flexed-jc-center', 'flexed-ai-center');

  document.querySelector('#manage-templates-action').appendChild(form);
}

function handleActivityEditOnClick(doc) {
  const form = document.querySelector(`.activity-form`);
  const requestBody = Object.assign(doc, {
    timestamp: Date.now(),
    attachment: {},
    // TODO: Handle venue ui and update
    venue: doc.venue,
    schedule: [],
  });

  // activity-container
  const activityContainer = document.querySelector('activity-container');
  const label = activityContainer.querySelector('.warning-label');

  if (label) {
    label.remove();
  }

  const attachmentFields = document.querySelectorAll('[data-attachment]');
  const scheduleFields = document.querySelectorAll('[data-schedule]');
  const venueFields = document.querySelectorAll('[data-venue]');

  console.log({ attachmentFields, scheduleFields, venueFields });

  attachmentFields.forEach(function (element) {
    const field = element.dataset.field;
    const type = element.dataset.type;
    let value = element.value;

    // Remove spaces between characters that some people use
    // while writing phone numbers
    if (type === 'phoneNumber') {
      value = value.replace(/\s+/g, '');
    }

    if (type === 'number') {
      value = Number(value);
    }

    requestBody.attachment[field] = {
      type,
      value,
    };
  });

  scheduleFields.forEach(function (element) {
    requestBody.schedule.push({
      startTime: '',
      endTime: '',
      name: element.dataset.name,
    });
  });

  venueFields.forEach(function (element) {
    requestBody.venue.push({
      venueDescriptor: element.dataset.venueDescriptor,
      geopoint: {
        latitude: element.dataset.latitude,
        longitude: element.dataset.longitude,
      },
      location: element.dataset.location,
      address: element.dataset.address,
    });
  });

  console.log('requestBody', requestBody);

  getLocation()
    .then(function (location) {
      requestBody.geopoint = location;
      let url = `${apiBaseUrl}/activities/update`;

      if (document.body.dataset.issupport) {
        url += '?support=true';
      }

      return sendApiRequest(
        url,
        requestBody,
        'PATCH'
      );
    })
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('response', response);

      let node = getWarningNode('Update successful');

      if (!response.success) {
        node = getWarningNode(response.message);
      }

      insertAfterNode(form, node);
    })
    .catch(function (error) {
      console.error(error);

      if (error === 'Please Enable Location') {
        const node = getWarningNode('Location access is required');

        insertAfterNode(form, node);

        return;
      }
    });
}

function getActivityEditObject(doc) {
  const container = document.createElement('div');
  container.classList.add('pad-10', 'border');

  const form = document.createElement('form');
  form.classList.add('pad-10', 'activity-form');
  form.id = doc.activityId;

  const attachmentContainer = document.createElement('div');
  attachmentContainer.classList.add('pad-10');
  attachmentContainer.style.display = 'flex';
  attachmentContainer.style.flexDirection = 'column';
  const telInputs = [];

  Object
    .keys(doc.attachment)
    .forEach(function (field) {
      const { type, value } = doc.attachment[field];

      const label = document.createElement('label');
      label.textContent = field;
      let input = document.createElement('input');
      input.value = value;

      // Skip this field since this is just an image
      if (type === 'base64') return;

      if (type === 'boolean') {
        input = document.createElement('select');
        const yes = document.createElement('option');
        const no = document.createElement('option');
        yes.textContent = 'Yes';
        no.textContent = 'No';
        yes.value = true;
        no.value = false;

        input.append(yes, no);
      }

      if (type === 'weekday') {
        input = document.createElement('select');
        moment
          .weekdays()
          .forEach(function (day) {
            const option = document.createElement('option');

            option.value = day.toLowerCase();
            option.textContent = day;

            input.appendChild(option);
          });
      }

      if (type === 'string') {
        input.type = 'text';
      }

      if (type === 'number') {
        input.type = 'number';
      }

      if (type === 'phoneNumber') {
        input.type = 'tel';

        telInputs.push({
          element: input,
          value,
        });

        input.value = '';
      }

      if (type === 'email') {
        input.type = 'email';
      }

      if (type === 'HH:MM') {
        input.type = 'time';
      }

      input.classList.add('input-field');

      if (field === 'Name' || field === 'Number') {
        input.required = true;
      }

      input.dataset.attachment = true;
      input.dataset.type = type;
      input.dataset.field = field;

      attachmentContainer.append(label, input);
    });

  // telInputs.forEach(function (item) {
  //   const inputElement = item.element;
  //   const value = item.value;

  //   inputElement.style.width = '100%';
  //   inputElement.style.height = '52px';

  //   window
  //     .intlTelInput(inputElement, intlTelInputOptions)
  //     .setNumber(value);
  // });

  form.appendChild(attachmentContainer);

  const scheduleContainer = document.createElement('div');
  scheduleContainer.classList.add('flexed-column', 'pad-10');
  const scheduleHeaderContainer = document.createElement('div');
  const scheduleHeader = document.createElement('h5');
  scheduleHeader.textContent = 'Schedule';
  scheduleHeader.classList.add('mb-16', 'ttuc', 'tac', 'bold', 'ft-size-20', 'bb');

  scheduleHeaderContainer.appendChild(scheduleHeader);
  scheduleContainer.appendChild(scheduleHeaderContainer);

  doc
    .schedule
    .forEach(function (item) {
      const { name, startTime, endTime } = item;

      const label = document.createElement('label');
      label.textContent = name;

      const startTimeInput = document.createElement('input');
      startTimeInput.type = 'date';
      startTimeInput.classList.add('input-field');

      if (startTime) {
        startTimeInput.valueAsDate = new Date(startTime);
      }

      const endtimeInput = document.createElement('input');
      endtimeInput.type = 'date';
      endtimeInput.classList.add('input-field');

      if (endTime) {
        endtimeInput.valueAsDate = new Date(endTime);
      }

      startTimeInput.dataset.schedule = true;
      startTimeInput.dataset.name = name;

      scheduleContainer.append(label, startTimeInput)
    });

  if (doc.schedule.length) {
    form.appendChild(scheduleContainer);
  }

  const venueContainer = document.createElement('div');
  venueContainer.classList.add('pad-10');

  const venueHeaderContainer = document.createElement('div');
  const venueHeading = document.createElement('h5');
  venueHeading.textContent = 'Locations';

  venueHeaderContainer.appendChild(venueHeading);
  venueHeaderContainer.classList.add('ttuc', 'tac', 'bb', 'ft-size-20', 'bold');

  venueContainer.appendChild(venueHeaderContainer);

  doc.venue.forEach(function (venue, index) {
    const venueDescriptor = venue.venueDescriptor;
    const address = venue.address;
    const location = venue.location;
    const geopoint = venue.geopoint;

    const singleVenue = document.createElement('div');
    singleVenue.dataset.venueDescriptor = venueDescriptor;
    singleVenue.dataset.address = address;
    singleVenue.dataset.location = location;
    singleVenue.dataset.latitude = geopoint.latitude || geopoint._latitude;
    singleVenue.dataset.longitude = geopoint.longitude || geopoint._longitude;

    const map = document.createElement('div');
    map.textContent = `map ${index}`;
    map.id = `map${index}`;
    map.style.width = '400px';
    map.style.height = '200px';

    venueContainer.appendChild(singleVenue);
  });

  if (doc.venue.length) {
    form.appendChild(venueContainer);
  }

  const assigneeHeadContainer = document.createElement('div');
  assigneeHeadContainer.classList.add('ttuc', 'bold');
  const assigneeHead = document.createElement('h5');
  assigneeHead.textContent = 'Assignees';
  assigneeHeadContainer.appendChild(assigneeHead);
  assigneeHeadContainer.classList.add('bb', 'tac', 'ft-size-20');
  const assigneeContainer = document.createElement('div');
  assigneeContainer.appendChild(assigneeHeadContainer);
  const assigneeUl = document.createElement('ul');

  doc
    .assignees
    .forEach(function (phoneNumber) {
      const li = document.createElement('li');
      const phoneSpan = document.createElement('span');
      phoneSpan.textContent = phoneNumber;
      phoneSpan.style.pointerEvents = 'none';
      phoneSpan.classList.add('mr-8');
      const tick = document.createElement('span');
      tick.innerHTML = '&#10005;';
      tick.style.pointerEvents = 'none';

      li.classList.add('cur-ptr');

      li.appendChild(phoneSpan);
      li.appendChild(tick);

      assigneeUl.appendChild(li);
    });

  const ulContainer = document.createElement('div');

  ulContainer.appendChild(assigneeUl);
  assigneeContainer.appendChild(ulContainer);

  if (doc.assignees.length) {
    form.appendChild(assigneeContainer);
  }

  const statusSelectionContainer = document.createElement('div');
  const statusSelectHeadContainer = document.createElement('div');
  const statusHeader = document.createElement('h5');
  statusHeader.classList.add('tac', 'ttuc', 'bold', 'ft-size-20', 'bb');
  statusHeader.textContent = `Status (${doc.status})`;
  statusSelectHeadContainer.append(statusHeader);

  statusSelectionContainer.appendChild(statusSelectHeadContainer);

  const statusSelect = document.createElement('select');
  statusSelect.dataset.status = true;

  statusSelect.classList.add('input-field');

  ['CANCELLED', 'CONFIRMED', 'PENDING']
    .forEach(function (status) {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = status;

      // Not putting the value which is already set in the list
      if (status === doc.status) return;

      statusSelect.appendChild(option);
    });

  statusSelect.style.marginTop = '8px';

  statusSelectionContainer.appendChild(statusSelect);

  form.appendChild(statusSelectionContainer);

  const buttonContainer = document.createElement('div');
  buttonContainer.classList.add('flexed', 'mt-16');
  const button = document.createElement('input');
  button.type = 'button';
  button.value = 'Update';
  button.classList.add('button', 'f1');

  button.onclick = function () {
    handleActivityEditOnClick(doc);
  };

  buttonContainer.appendChild(button);

  form.appendChild(buttonContainer);

  container.appendChild(form);

  return container;
};

function activityEditOnClick(doc) {
  const container = document.querySelector('.activity-container');

  while (container.firstChild) {
    container.firstChild.remove();
  }

  const dataContainer = getActivityEditObject(doc);
  dataContainer.style.borderWidth = '5px';
  dataContainer.style.borderStyle = 'solid';
  dataContainer.style.borderColor = '#7fdbff';
  // dataContainer.classList.add('single-activity');

  if (doc.status === 'CANCELLED') {
    dataContainer.style.borderColor = '#ff4136';
    // dataContainer.classList.add('cancelled');
  }

  container.appendChild(dataContainer);
}


// TODO: This perhaps should be made a little better
function getActivityName(doc) {
  return doc.activityName;
}

function getSearchActivityListItem(doc) {
  const li = document.createElement('li');
  // li.style.padding = '10px';
  // li.style.borderLeftColor = '#0074D9';
  // li.style.borderLeftWidth = '5px';
  // li.style.borderLeftStyle = 'solid';
  // li.style.backgroundColor = '#7FDBFF';
  // li.style.color = 'white';

  li.className += 'mb-8 cur-ptr flexed single-activity border';

  // li.classList.add('bb', 'mb-8', 'cur-ptr', 'flexed');
  const iconContainer = document.createElement('div');
  iconContainer.classList.add('mr-8', 'flexed-ai-center');
  const i = document.createElement('i');
  i.classList.add('far', 'fa-check-circle');

  if (doc.status === 'CANCELLED') {
    // li.style.color = 'unset';
    // li.classList.add('raised');
    // li.style.backgroundColor = 'unset';
    // li.style.borderLeftColor = '#FF4136';
    li.className += ' cancelled';
    i.classList.remove('fa-check-circle');
    // <i class="far fa-times-circle"></i>
    i.classList.add('fa-times-circle');
  }

  iconContainer.appendChild(i);

  const bodyContainer = document.createElement('div');
  bodyContainer.classList.add('flexed-column');
  const activityName = document.createElement('span');
  activityName.textContent = getActivityName(doc);
  const status = document.createElement('span');
  status.textContent = doc.status;
  status.style.color = '#0074D9';
  status.style.fontWeight = 'bold';

  bodyContainer.appendChild(activityName);
  bodyContainer.appendChild(status);
  iconContainer.style.pointerEvents = 'none';
  bodyContainer.style.pointerEvents = 'none';

  li.appendChild(iconContainer);
  li.appendChild(bodyContainer);

  li.onclick = function () {
    activityEditOnClick(doc);
  };

  return li;
};

function searchUpdateTemplateSelectOnChange() {
  const container = document.querySelector('.search-update');
  const templateSelect = container.querySelector('.templates-list');
  const selectedTemplate = templateSelect.value;
  const ul = document.querySelector('.activity-ul');

  while (ul.firstChild) {
    ul.firstChild.remove();
  }

  console.log('Selected', selectedTemplate);

  // activity-container
  const activityContainer = document.querySelector('.activity-container div');

  if (activityContainer) {
    activityContainer.remove();
  }

  const url = `/json?office=${document.body.dataset.office}`
    + `&template=${selectedTemplate}`;

  sendApiRequest(url)
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('response', response);

      Object
        .keys(response)
        .forEach(function (key) {
          const doc = response[key];
          const li = getSearchActivityListItem(doc);

          ul.appendChild(li);
        });
    })
    .catch(console.error);
}

function searchAndUpdate() {
  setActionTitle('Search & Update');

  const container = document.querySelector('.search-update');
  container.classList.remove('hidden');
  const templateSelect = container.querySelector('.templates-list');

  sendApiRequest('/json?action=get-template-names')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      response.forEach(function (name) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;

        templateSelect.appendChild(option);
      });

      templateSelect.onchange = searchUpdateTemplateSelectOnChange;
    })
    .catch(console.error);
}

function startOfficeJoinFlow() {
  console.log('fetching stuff... for office');
}

function joinFormSelfPhoneOnInput(evt) {
  console.log('Typed', evt.target.value);
  // const form = document.querySelector('.join-form');

  if (!isValidPhoneNumber(evt.target.value)) {
    return;
  }

  startOfficeJoinFlow();
}

window.onload = function () {
  const phoneField = document.querySelector('#phone');

  if (phoneField) {
    phoneField.onfocus = function () {
      const altContact = document.querySelector('#alt-contact');
      phoneField.style.height = '58px';
      phoneField.classList.add('mw-100');
      altContact.style.height = '58px';
      altContact.classList.add('mw-100');

      window.intlTelInput(phoneField, intlTelInputOptions);
      // window.intlTelInput(altContact, intlTelInputOptions);

      // Required, otherwise this initialization will try to run everytime
      // the user tries to type something in the field
      phoneField.onfocus = null;
      phoneField.oninput = joinFormSelfPhoneOnInput;
    }
  }
};

function populateTemplateSelect(selectElement) {
  return sendApiRequest(`/json?action=get-template-names`)
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      response.forEach(function (name) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;

        selectElement.appendChild(option);
      });

      selectElement.onchange = function () {
        document
          .querySelector('.bc-file-drag')
          .classList
          .remove('hidden');

        document.querySelector('.bc-container').style.minHeight = '200px';
      }
    })
    .catch(console.error);
}

function populateBulkCreationResult(response) {
  document
    .querySelector('.bc-results')
    .classList
    .remove('hidden');

  console.log('response', response);

  const ul = document.querySelector('.bc-results-list');

  function getLi(item) {
    const container = document.createElement('li');
    container.classList.add('success', 'flexed-column');
    const firstRow = document.createElement('span');
    const secondRow = document.createElement('span');
    firstRow.textContent = item.Name || item.Admin || item.Subscriber;
    secondRow.textContent = item.reason || '';

    container.append(firstRow, secondRow);

    if (item.rejected) {
      container.classList.remove('success');
      container.classList.add('failure', 'raised');
    }

    return container;
  }

  response.data.forEach(function (item) {
    const li = getLi(item);

    ul.appendChild(li);
  });
};

function sendBulkCreateJson(jsonData) {
  console.log('jsonData:', jsonData);

  let requestUrl = `${apiBaseUrl}/admin/bulk`;

  if (document.body.dataset.issupport) {
    requestUrl += `?support=true`;
  }

  const requestBody = {
    timestamp: Date.now(),
    office: document.body.dataset.office,
    data: jsonData,
    template: document.querySelector('.bc-container select').value,
  };

  getLocation()
    .then(function (location) {
      requestBody.geopoint = location;

      return sendApiRequest(requestUrl, requestBody, 'POST');
    })
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      populateBulkCreationResult(response);
    })
    .catch(console.error);
};

function handleXlSXFile(element) {
  console.log('El', element);

  const file = element.target.files[0];
  const fReader = new FileReader();

  fReader.readAsBinaryString(file);

  fReader.onloadend = function (event) {
    const wb = XLSX.read(event.target.result, {
      type: 'binary'
    });

    const ws = wb.Sheets[wb.SheetNames[0]];

    const jsonData = XLSX.utils.sheet_to_json(ws, {
      blankRows: true,
      defval: '',
      raw: false
    });

    sendBulkCreateJson(jsonData);
  }
}

function bulkCreate() {
  setActionTitle('Create New');

  const bcContainer = document.querySelector('.bc-container');
  const selectElement = bcContainer.querySelector('select');
  bcContainer.classList.remove('hidden');

  populateTemplateSelect(selectElement)
    .then(function () {

      const fileDragInput = bcContainer.querySelector('input[type="file"]');

      fileDragInput.onchange = handleXlSXFile;
    });
}

function updateEmailInReports() {
  console.log('Update Email in reports clicked');
  setActionTitle('Update Report Emails');
}

window.addEventListener('DOMContentLoaded', function () {
  if (sessionStorage.getItem('office')) {
    document.body.dataset.office = sessionStorage.getItem('office');
  }

  const cachedList = sessionStorage.getItem('officeNamesList');
  const officeSelect = document.querySelector('#all-office-form');
  /**
   * Since the list is cached for this session, no need to fetch
   * the office list
   */
  if (cachedList && officeSelect) {
    fetchOfficeList();
  }
});

window.onload = function () {
  const officeSelect = document.querySelector('#all-office-form');
  const cachedList = sessionStorage.getItem('officeNamesList');

  /** If the list has been cached during this session, ignore */
  if (officeSelect && !cachedList) {
    fetchOfficeList();
  }
}

window.onbeforeunload = function () {
  if (document.body.dataset.office) {
    sessionStorage.setItem('office', document.body.dataset.office);
  }
}
