'use strict';

function isValidJSON(json) {
  try {
    JSON.parse(json);

    return true;
  } catch (error) {
    console.log('error', error);
    return false;
  }
}

function getButtonElement(value, classes) {
  const button = document.createElement('input');
  button.type = 'button';
  button.classList += ` ${classes}`;

  return button;
}

function isSupport() {
  return JSON.parse(document.body.dataset.user || {}).isSupport;
}

function getAdminOffices() {
  return JSON.parse(document.body.dataset.user || {}).admin;
}

function isAdmin() {
  const adminOffices = getAdminOffices();

  return adminOffices && adminOffices.length;
}

function isTemplateManager() {
  return JSON.parse(document.body.dataset.user || {}).isTemplateManager;
}

function removeAllChildren(element) {
  if (!element || !element.firstChild) return;

  while (element.firstChild) {
    element.firstChild.remove();
  }
}

function showActionsSection() {
  document
    .querySelector('#actions-section')
    .classList
    .remove('hidden');
}

function toggleActionsSection() {
  document
    .querySelector('#actions-section')
    .classList
    .toggle('hidden');
}

function hideActionsSection() {
  document
    .querySelector('#actions-section')
    .classList
    .add('hidden');
}

function setBreadcrumb(action) {
  const ul = document.querySelector('.breadcrumbs ul');

  removeAllChildren(ul);

  const home = document.createElement('li');
  const homeA = document.createElement('a');

  homeA.textContent = document.body.dataset.office || 'Home';
  homeA.href = '#';

  homeA.onclick = function (evt) {
    evt.preventDefault();

    showActionsSection();
    setBreadcrumb();
    removeAllChildren(document.querySelector('.forms-parent'));

    document
      .querySelector('.hero-actions')
      .classList
      .toggle('hidden');
  };

  home.appendChild(homeA);

  const li = document.createElement('li');
  const a = document.createElement('a');
  a.textContent = action;
  a.href = '#';

  /** Do nothing since this path is open already for the user */
  a.onclick = function (evt) { evt.preventDefault(); };
  a.classList.add('bold');
  li.appendChild(a);
  ul.append(home);

  if (action) {
    ul.appendChild(li);
  }
}

function setActionTitle(text) {
  document
    .querySelector('.action-title')
    .textContent = text;

  if (text) setBreadcrumb(text);
}

function handleTopSelectTemplateClick(evt) {
  console.log('handleTopSelectTemplateClick', evt);
}

function allOfficeSelectOnChange() {
  const officeSelect = document.querySelector('#all-office-form select');
  const office = officeSelect.options[officeSelect.selectedIndex].value;
  document.body.dataset.office = office;

  const supportSearch = document.querySelector('#support-office-search');

  supportSearch.remove();

  // showActionsSection();
  toggleActionsSection();
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

  sendApiRequest('/json?action=office-list')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('response', response);
      /** Caching the values for the current session */
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
}

function startAdmin() {
  document.body.dataset.office = document.getElementById('office-selector').value;

  // Hide the section containing the office select
  document
    .getElementById('office-form')
    .parentElement
    .classList
    .add('hidden');

  showActionsSection();
}

function handlePhoneNumberChange() {
  const form = document.querySelector('.pnc-form');
  const requestBody = {
    oldPhoneNumber: form.querySelector('input[data-old-phone-number="true"]').value,
    newPhoneNumber: form.querySelector('input[data-new-phone-number="true"]').value,
    office: document.body.dataset.office,
  };

  let requestUrl = `${apiBaseUrl}/admin/change-phone-number`;

  if (isSupport()) {
    requestUrl += '?support=true';
  }

  console.log('requestBody', requestBody);

  sendApiRequest(requestUrl, requestBody, 'POST')
    .then(function (response) { return response.json(); })
    .then(function (response) {
      createSnackbar(response.message || 'Phone Number updated successfully');
    })
    .catch(console.error);
}

function handleUpdateAuthRequest() {
  const form = document.querySelector('.forms-parent');
  const phoneNumber = form.querySelector('input[type="tel"]').value;
  const displayName = form.querySelector('input[data-display-name=true]').value;
  const email = form.querySelector('input[type="email"]').value;
  const p = form.querySelector('p');
  p.textContent = '';
  p.classList.add('col-red');

  console.log('phoneNumber', phoneNumber);
  if (!isValidPhoneNumber(phoneNumber)) {
    p.textContent = 'Invalid phone number';

    p.classList.remove('hidden');

    return;
  }

  if (!isValidEmail(email)) {
    p.textContent = 'Invalid email';

    p.classList.remove('hidden');

    return;
  }

  if (!isNonEmptyString(displayName)) {
    p.textContent = 'Invalid Name';

    return;
  }

  sendApiRequest(
    `${apiBaseUrl}/update-auth`,
    {
      phoneNumber,
      displayName,
      email,
    },
    'POST'
  )
    .then(function (response) { return response.json(); })
    .then(function (response) {
      console.log('result', response);
      createSnackbar(response.message || 'Success');
    })
    .catch(console.error);
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

function handleActivityEditOnClick(doc) {
  const requestBody = Object.assign(doc, {
    timestamp: Date.now(),
    attachment: {},
    venue: doc.venue,
    schedule: [],
  });

  const attachmentFields = document.querySelectorAll('[data-attachment]');
  const scheduleFields = document.querySelectorAll('[data-schedule]');
  const venueFields = document.querySelectorAll('[data-venue]');

  attachmentFields.forEach(function (element) {
    const field = element.dataset.field;
    const type = element.dataset.type;
    let value = element.value;

    if (type === 'phoneNumber' && value) {
      // Remove spaces between characters that some people use
      // while writing phone numbers
      value = value.replace(/\s+/g, '');

      if (!value.startsWith(window.countryCode)) {
        value = `+${window.countryCode}${value}`;
      }
    }

    if (type === 'number') {
      value = Number(value);
    }

    if (type === 'boolean') {
      value = value === 'true' ? true : false;
    }

    requestBody.attachment[field] = {
      type,
      value,
    };
  });

  console.log('scheduleFields', scheduleFields);

  scheduleFields.forEach(function (element) {
    let timestamp = '';

    if (element.value) {
      timestamp = new Date(element.value).getTime();
    }

    requestBody.schedule.push({
      startTime: timestamp,
      endTime: timestamp,
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

      if (isSupport()) {
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
      createSnackbar(response.message || 'Update Successful', 'Dismiss');
    })
    .catch(function (error) {
      console.error(error);

      if (error === 'Please Enable Location') {
        createSnackbar('Location access is required', 'Dismiss');
      }

      createSnackbar('Something went wrong', 'Dismiss');
    });
}

function showActivityCancellationWarning(doc) {
  const modalBodyElement = document.createElement('div');
  modalBodyElement.className += 'pad';

  const p = document.createElement('p');
  p.textContent = `You are about to cancel`
    + ` ${doc.activityName}`;

  modalBodyElement.append(p);

  const buttonContainer = document.createElement('div');
  const okButton = getButton('OK');
  buttonContainer.className += ' bt';
  okButton.className += ' mt-16';
  buttonContainer.append(okButton);
  modalBodyElement.appendChild(buttonContainer);

  const modal = getModal({
    title: `Cancel ${doc.template} ${doc.activityName}?`,
    modalBodyElement,
  });

  okButton.onclick = function () {
    window.warningShownAlready = true;

    closeModal();
  }


  document.body.appendChild(modal);
}

function sendActivityStatusChangeRequest(doc, newStatus) {
  const requestBody = (function () {
    if (doc.template === 'employee') {
      return {
        office: document.body.dataset.office,
        phoneNumber: doc.attachment['Employee Contact'].value,
      };
    }

    return {
      activityId: doc.activityId,
      status: newStatus,
      timestamp: Date.now(),
      geopoint: {},
    }
  })();

  if (newStatus === 'CANCELLED'
    && !window.warningShownAlready) {
    showActivityCancellationWarning(doc);

    return;
  }

  const requestUrl = (function () {
    if (doc.template === 'employee') {
      return `${apiBaseUrl}/remove-employee`;
    }

    return `${apiBaseUrl}/activities/change-status`;
  })();

  if (isSupport()) {
    requestUrl += '?support=true';
  }

  getLocation()
    .then(function (geopoint) {
      requestBody.geopoint = geopoint;

      console.log('requestBody', requestBody);

      return sendApiRequest(`${requestUrl}`, requestBody, 'PATCH')
    })
    .then(function (response) { return response.json() })
    .then(function (response) {
      createSnackbar(response.message || 'Update Successful');
    })
    .catch(function (error) {
      createSnackbar(error, 'OK');
    });
}

function getButton(value, secondary) {
  const button = document.createElement('input');
  button.type = 'button';
  button.value = value;
  button.classList.add('button');

  if (secondary) {
    button.classList.add('secondary');
  }

  return button;
}

function getActivityEditObject(doc) {
  const container = document.createElement('div');
  const form = document.createElement('form');

  form.classList.add('activity-form');
  form.id = doc.activityId;

  const attachmentContainer = document.createElement('div');
  attachmentContainer.classList.add('pad-10');
  attachmentContainer.style.display = 'flex';
  attachmentContainer.style.flexDirection = 'column';

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

        input.value = value;
      }

      if (type === 'email') {
        input.type = 'email';
      }

      if (type === 'HH:MM') {
        input.type = 'time';
      }

      input.classList.add('input-field');

      if (field === 'Name'
        || field === 'Number') {
        input.required = true;
      }

      input.dataset.attachment = true;
      input.dataset.type = type;
      input.dataset.field = field;

      attachmentContainer.append(label, input);
    });

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
        startTimeInput.dataset.schedule = true;
      }

      const endtimeInput = document.createElement('input');
      endtimeInput.type = 'date';
      endtimeInput.classList.add('input-field');

      if (endTime) {
        endtimeInput.valueAsDate = new Date(endTime);
      }

      startTimeInput.dataset.schedule = true;
      startTimeInput.dataset.name = name;

      scheduleContainer.append(label, startTimeInput);
    });

  if (doc.schedule.length > 0) {
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
    map.style.minWidth = '300px';
    map.style.minHeight = '400px';

    window[`map_${index}`] = new google
      .maps
      .Map(map, {
        zoom: 16,
        center: {
          lat: Number(geopoint.latitude || geopoint._latitude),
          lng: Number(geopoint.longitude || geopoint._longitude),
        },
      });

    singleVenue.appendChild(map);
    venueContainer.appendChild(singleVenue);
  });

  if (doc.venue.length > 0) {
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
    .forEach(function (phoneNumber, index) {
      const li = document.createElement('li');
      const phoneSpan = document.createElement('span');
      phoneSpan.textContent = phoneNumber;
      phoneSpan.style.pointerEvents = 'none';
      phoneSpan.classList.add('mr-8');

      li.classList.add('cur-ptr', 'mb-8');

      if (index === 0) {
        li.className += ' mt-8';
      }

      li.appendChild(phoneSpan);

      assigneeUl.appendChild(li);
    });

  const ulContainer = document.createElement('div');

  ulContainer.appendChild(assigneeUl);
  assigneeContainer.appendChild(ulContainer);

  if (doc.assignees.length) {
    form.appendChild(assigneeContainer);
  }

  const buttonContainer = document.createElement('div');
  buttonContainer.classList.add('flexed', 'mt-16', 'activity-buttons');
  const updateButton = getButton('Update');
  const confirmButton = getButton('Confirm', true);
  const cancelButton = getButton('Cancel', true);
  const pendingButton = getButton('Pending', true);

  confirmButton
    .onclick = function () {
      sendActivityStatusChangeRequest(doc, 'CONFIRMED');
    }
  cancelButton
    .onclick = function () {
      sendActivityStatusChangeRequest(doc, 'CANCELLED');
    }
  pendingButton
    .onclick = function () {
      sendActivityStatusChangeRequest(doc, 'PENDING');
    }

  updateButton
    .onclick = function () {
      handleActivityEditOnClick(doc);
    };

  buttonContainer.append(updateButton);

  if (doc.status === 'CONFIRMED') {
    buttonContainer.append(pendingButton, cancelButton);
  }

  if (doc.status === 'PENDING') {
    buttonContainer.append(confirmButton, cancelButton);
  }

  if (doc.status === 'CANCELLED') {
    buttonContainer.append(confirmButton, pendingButton);
  }

  form.appendChild(buttonContainer);

  container.appendChild(form);

  return container;
}

function activityEditOnClick(doc) {
  const container = document.querySelector('.single-activity');

  removeAllChildren(container);

  const dataContainer = getActivityEditObject(doc);
  container.className += ` raised`;

  container.appendChild(dataContainer);

  dataContainer.querySelectorAll('input[type="tel"]').forEach(el => {
    initializeTelInput(el);
  });
}


// TODO: This perhaps should be made a little better
function getActivityName(doc) {
  return doc.activityName;
}

function getActivityListItem(doc) {
  const li = document.createElement('li');
  li.className += 'mb-8 cur-ptr flexed single-activity-item border';

  const iconContainer = document.createElement('div');
  iconContainer.classList.add('mr-8', 'flexed-ai-center');
  const i = document.createElement('i');
  i.classList.add('far', 'fa-check-circle');

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

  if (doc.status === 'CANCELLED') {
    li.className += ' cancelled';
    i.classList.remove('fa-check-circle');
    i.classList.add('fa-times-circle');

    status.style.color = 'rgb(255, 65, 54)';
  }

  li.appendChild(iconContainer);
  li.appendChild(bodyContainer);

  li.onclick = function () {
    activityEditOnClick(doc);
  };

  return li;
}

function searchUpdateTemplateSelectOnChange() {
  const templateSelect = document.querySelector('.forms-parent select');
  const selectedTemplate = templateSelect.value;
  const ul = document.querySelector('.activity-list');

  removeAllChildren(ul);

  // activity-form
  removeAllChildren(document.querySelector('.activity-form'));

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
          const li = getActivityListItem(doc);

          ul.appendChild(li);
        });
    })
    .catch(console.error);
}

function searchAndUpdate() {
  setActionTitle('Search & Update');
  hideActionsSection();
  const container = document.querySelector('.forms-parent');

  container.classList += ' pad';

  const listOfTemplates = document.createElement('select');
  const activityDiv = document.createElement('div');

  activityDiv.className += ' activity-parent';

  const listOfActivities = document.createElement('ul');
  const singleActivity = document.createElement('div');

  listOfActivities.classList += ' activity-list';
  singleActivity.classList.add('single-activity');
  listOfTemplates.className += ' input-field w-100';

  activityDiv.append(listOfActivities, singleActivity);
  container.append(listOfTemplates, activityDiv);

  sendApiRequest('/json?action=get-template-names')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      response.forEach(function (name) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;

        listOfTemplates.appendChild(option);
      });

      listOfTemplates.onchange = searchUpdateTemplateSelectOnChange;
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

function populateTemplateSelect(selectElement) {
  return sendApiRequest(`/json?action=get-template-names`)
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      selectElement.firstElementChild.remove();

      response.forEach(function (name) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;

        selectElement.appendChild(option);
      });

      selectElement.onchange = function () {
        removeAllChildren(document.querySelector('.bc-results-list'));

        document
          .querySelector('.bc-file-drag')
          .classList
          .remove('hidden');

        document.querySelector('.bc-container').style.minHeight = '200px';
      };
    })
    .catch(console.error);
}

function getBulkCreateResultLi(item) {
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

function populateBulkCreationResult(response) {
  document
    .querySelector('.bc-results')
    .classList
    .remove('hidden');

  console.log('response', response);

  const ul = document.querySelector('.bc-results-list');

  response.data.forEach(function (item) {
    const li = getBulkCreateResultLi(item);

    ul.appendChild(li);
  });
}


function sendBulkCreateJson(jsonData) {
  console.log('jsonData:', jsonData);

  let requestUrl = `${apiBaseUrl}/admin/bulk`;

  if (isSupport()) {
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
}

function handleExcelOrCsvFile(element) {
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
  };
}

function bulkCreate() {
  setActionTitle('Create New');

  const bcContainer = document.querySelector('.bc-container');
  const selectElement = bcContainer.querySelector('select');
  bcContainer.classList.remove('hidden');

  populateTemplateSelect(selectElement)
    .then(function () {

      const fileDragInput = bcContainer.querySelector('input[type="file"]');

      fileDragInput.onchange = handleExcelOrCsvFile;
    });
}

function recipientAssigneeUpdateOnClick(evt) {
  const container = document
    .querySelector(`div[data-name="${evt.target.dataset.name}"]`);

  console.log('target', container);

  const allPhoneNumberElements = container
    .querySelectorAll('span[data-phone-number="true"]');

  const toRemove = new Set();
  const allPhoneNumbers = new Set();

  allPhoneNumberElements.forEach(function (element) {
    if (element.classList.contains('striked')) {
      toRemove.add(element.textContent);
    }

    allPhoneNumbers.add(element.textContent);
  });

  const telInputs = container.querySelectorAll('input[type="tel"]');
  const toAdd = new Set();

  telInputs.forEach(function (elem) {
    if (!isValidPhoneNumber(elem.value)) {
      return;
    }

    toAdd.add(elem.value);
    allPhoneNumbers.add(elem.value);
  });

  console.log('toAdd', toAdd);
  console.log('toRemove', toRemove);
  console.log('allPhoneNumbers', [...allPhoneNumbers.values()]);

  const final = new Set();

  allPhoneNumbers.forEach(function (phoneNumber) {
    if (toRemove.has(phoneNumber)) {
      return;
    }

    final.add(phoneNumber);
  });

  const finalAssignees = Array.from(final);

  console.log({ finalAssignees });

  const requestBody = {
    timestamp: Date.now(),
    activityId: container.dataset.activityId,
    share: finalAssignees,
  };

  getLocation()
    .then(function (location) {
      requestBody.geopoint = location;

      let requestUrl = `${apiBaseUrl}/activities/share`;

      if (isSupport()) {
        requestUrl += '?support=true';
      }

      return sendApiRequest(requestUrl, requestBody, 'PATCH');
    })
    .then(function (response) { return response.json() })
    .then(function (response) {
      console.log(response);
    })
    .catch(console.error);
}

function addNewAssignee(evt) {
  const parent = evt.target.parentElement;
  const ul = parent.querySelector('ul');
  const input = document.createElement('input');
  input.classList.add('input-field', 'w-100');

  insertAfterNode(ul, input);
  initializeTelInput(input);

  const buttonContainer = parent
    .querySelector('input[type="button"]')
    .parentElement;

  buttonContainer.classList.remove('hidden');
}

function getRecipientActivityContainer(doc) {
  const container = document.createElement('div');
  container.dataset.activityId = doc.activityId;
  container.dataset.name = doc.attachment.Name.value;
  const heading = document.createElement('h5');
  heading.className = 'ttuc bold mb-16 bb';
  heading.textContent = doc.attachment.Name.value;
  const list = document.createElement('ul');

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'tac';
  const button = document.createElement('input');
  button.type = 'button';
  button.classList.add('button', 'mt-16');
  button.value = 'Submit';
  /** Used for querying the parent of this button on click */
  button.dataset.name = doc.attachment.Name.value;
  button.onclick = recipientAssigneeUpdateOnClick;
  buttonContainer.classList.add('hidden');
  buttonContainer.appendChild(button);

  doc.assignees.forEach(function (phoneNumber) {
    const li = document.createElement('li');
    li.className = 'flexed';
    const span = document.createElement('span');
    span.classList.add('cur-ptr');
    span.textContent = phoneNumber;
    span.dataset.phoneNumber = true;
    const icon = document.createElement('i');
    icon.className = 'far fa-times-circle col-gray ml-8';
    icon.style.lineHeight = 'inherit';

    li.append(span, icon);

    li.onclick = function () {
      span.classList.toggle('striked');

      if (buttonContainer.classList.contains('hidden')) {
        buttonContainer.classList.remove('hidden');
      }
    };

    list.appendChild(li);
  });

  const addPhoneNumberIcon = document.createElement('i');
  addPhoneNumberIcon.className = 'fas fa-plus ft-size-20';

  const addMore = document.createElement('div');

  addMore.classList.add('pad-10', 'tac', 'border', 'cur-ptr');
  addMore.append(addPhoneNumberIcon);
  addMore.onclick = addNewAssignee;
  container.append(heading, list, addMore, buttonContainer);
  container.className += ' raised pad mb-16';

  return container;
}

function handleRecipientSelectOnChange(evt) {
  const requestUrl = `/json?`
    + `action=${document.body.dataset.office}`
    + `&template=${evt.target.value}`;

  sendApiRequest(requestUrl)
    .then(function (response) { return response.json(); })
    .then(function (response) {
      console.log('Response', response);
    })
    .catch(console.error);
}

function updateEmailInReports() {
  console.log('Update Email in reports clicked');
  setActionTitle('Update Report Emails');
  hideActionsSection();

  const container = document.createElement('div');
  container.className = 'pad';
  const heading = document.createElement('h5');
  heading.className = 'ft-size-20 ttuc tac bold mb-16';
  heading.textContent = 'Update Report Recipients';
  const div = document.createElement('div');

  div.classList.add('grid-container-1', 'gg-5');

  container.append(heading, div);

  document
    .querySelector('.forms-parent')
    .appendChild(container);

  const requestUrl = `/json?template=recipient`
    + `&office=${document.body.dataset.office}`;

  console.log('RequestSent', requestUrl);

  sendApiRequest(requestUrl)
    .then(function (response) { return response.json(); })
    .then(function (response) {
      console.log('Response', response);

      Object
        .keys(response)
        .forEach(function (activityId) {
          const doc = response[activityId];

          div.appendChild(getRecipientActivityContainer(doc));
        });
    })
    .catch(console.error);
}

function onDomContentLoaded() {
  if (sessionStorage.getItem('office')) {
    document.body.dataset.office = sessionStorage.getItem('office');
  }

  if (isTemplateManager()) {
    document.querySelector('#actions-section').classList.remove('hidden');
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
}

function updateAuth() {
  setActionTitle('Verify Email Addresses');
  hideActionsSection();

  const container = document.querySelector('.forms-parent');
  const form = document.createElement('form');
  form.autocomplete = 'off';

  form.classList.add('pad', 'flexed-column', 'update-auth-form', 'raised', 'mt-16');

  const phoneNumberLabel = document.createElement('label');
  phoneNumberLabel.textContent = 'Phone Number';

  const phoneInput = document.createElement('input');
  phoneInput.classList.add('input-field');
  phoneInput.type = 'tel';

  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Name';

  const nameInput = document.createElement('input');
  nameInput.classList.add('input-field');
  nameInput.placeholder = 'John Doe';
  nameInput.dataset.displayName = true;

  const emailLabel = document.createElement('label');
  emailLabel.textContent = 'Email';

  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.placeholder = 'you@growthfile.com';
  emailInput.classList.add('input-field');

  const submitInput = document.createElement('input');
  submitInput.type = 'button';
  submitInput.value = 'Submit';
  submitInput.classList.add('button');
  submitInput.classList.add('mt-16');

  submitInput.onclick = handleUpdateAuthRequest;

  const messageP = document.createElement('p');
  messageP.classList.add('bold', 'ttuc', 'hidden', 'tac');

  form.append(
    messageP,
    phoneNumberLabel,
    phoneInput,
    nameLabel,
    nameInput,
    emailLabel,
    emailInput,
    submitInput
  );

  container.appendChild(form);

  initializeTelInput(phoneInput);
}

function recipientSubmitOnClick() {
  const form = document.querySelector('.forms-parent');
  const startTime = new Date(
    form.querySelector('input[type="date"]').value
  )
    .getTime();
  const triggerResult = form.querySelector('p');

  triggerResult.textContent = '';

  const requestBody = {
    startTime,
    office: document.body.dataset.office,
    report: form.querySelector('select').value,
    endTime: startTime,
  };

  console.log('Request sent', requestBody);

  sendApiRequest(`${apiBaseUrl}/admin/trigger-report`, requestBody,
    'POST'
  )
    .then(function (response) { return response.json(); })
    .then(function (response) {
      console.log('Response', response);

      if (!response.success) {
        triggerResult.classList.add('warning-label');
      }

      triggerResult.textContent = response.message
        || 'Report triggered successfully';

    })
    .catch(console.error);
}

function triggerReports() {
  setActionTitle('Trigger Reports');
  hideActionsSection();

  const container = document.createElement('div');
  container.className += ' trigger-reports pad';
  const select = document.createElement('select');
  select.className += ' input-field';

  const p = document.createElement('p');
  p.className += ' hidden col-green';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.valueAsDate = new Date();
  dateInput.className += ' input-field';

  const submit = document.querySelector('input');
  submit.type = 'button';
  submit.value = 'Submit';
  // submit.classList.add('button');
  submit.className += ' button mt-16';
  submit.style.marginLeft = 'auto';
  submit.style.marginRight = 'auto';

  const form = document.createElement('form');

  form.className += 'pad raised flexed-column';

  const head = document.createElement('div');
  const h5 = document.createElement('h5');
  h5.classList += ' ttuc bold';
  h5.textContent = 'Trigger Reports';
  const description = document.createElement('p');
  description.textContent = 'Select a date to get reports to your email';
  description.className += ` col-gray`;

  head.append(h5, description);

  head.classList.add('tac');
  form.append(select, dateInput, submit);
  container.append(head, form);
  document
    .querySelector('.forms-parent')
    .append(container);

  const requestUrl = `/json?template=recipient`
    + `&office=${document.body.dataset.office}`;

  sendApiRequest(requestUrl, null, 'GET')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('response', response);

      Object
        .keys(response)
        .forEach(function (activityId) {
          const item = response[activityId];
          const option = document.createElement('option');
          option.value = item.attachment.Name.value;
          option.textContent = item.attachment.Name.value;
          select.appendChild(option);
        });

      submit.onclick = recipientSubmitOnClick;
    })
    .catch(console.error);
}

function changePhoneNumber() {
  setActionTitle('Change Phone Number');
  hideActionsSection();

  const container = document.createElement('div');
  container.className += ' pad';
  const headingContainer = document.createElement('div');
  const h5 = document.createElement('h5');

  h5.textContent = `Update an employee's phone number`;
  h5.className += ' tac bold ttuc ft-size-20 mb-16';

  headingContainer.append(h5);

  const form = document.createElement('form');

  form.className = 'raised pad flexed-column pnc-form';

  const p = document.createElement('p');
  const oldLabel = document.createElement('label');
  oldLabel.textContent = 'Old Phone Number';
  const newLabel = document.createElement('label');
  newLabel.textContent = 'New Phone Number';
  const oldInput = document.createElement('input');
  oldInput.type = 'tel';
  oldInput.dataset.oldPhoneNumber = true;
  oldInput.className += ' input-field';

  const newInput = document.createElement('input');
  newInput.type = 'tel';
  newInput.dataset.newPhoneNumber = true;
  newInput.className += ' input-field';

  const submit = document.createElement('input');
  submit.type = 'button';
  submit.value = 'Submit';
  submit.className += 'button';
  submit.style.marginLeft = 'auto';
  submit.style.marginRight = 'auto';

  submit.onclick = handlePhoneNumberChange;

  form.append(
    p,
    oldLabel,
    oldInput,
    newLabel,
    newInput,
    submit
  );

  container.append(headingContainer, form);

  document
    .querySelector('.forms-parent')
    .append(container);

  initializeTelInput(oldInput);
  initializeTelInput(newInput);
}


function sendUpdateTemplateRequest(newText) {
  sendApiRequest('/json?action=update-template', JSON.parse(newText), 'POST')
    .then(function (response) { return response.json(); })
    .then(function (response) {
      console.log('Response', response);

      if (response.success) {
        const button = document.querySelector('#template-update-button');
        button.value = 'Close';

        button.onclick = function () {
          closeModal();
        };
      }

      createSnackbar(response.message || 'Update Successful', 'Dismiss');
    })
    .catch(console.error);
}

function viewTemplateButtonOnClick(evt) {
  const button = evt.target;
  const li = evt.target.parentElement.parentElement;
  console.log('View:', li);

  const viewTemplateContainer = document.createElement('div');
  viewTemplateContainer.className += ' pad';

  const template = JSON.parse(sessionStorage.getItem('cachedTemplates'))[button.dataset.templateId];
  const templateText = JSON.stringify(template, ' ', 4);

  const editorDiv = document.createElement('div');
  const pre = document.createElement('pre');
  pre.textContent = templateText;
  editorDiv.className += ' pad';
  editorDiv.append(pre);

  editorDiv.onclick = function () {
    editorDiv.setAttribute('contenteditable', true);
    editorDiv.style.backgroundColor = '#f7f7f7';

    const modalContent = document.querySelector('.modal-content');

    if (modalContent.dataset.edited) {
      return;
    }

    const buttonContainer = document.createElement('div');
    const button = document.createElement('input');
    button.id = 'template-update-button';

    button.type = 'button';
    button.value = 'Update';
    button.className += ' button secondary';
    buttonContainer.append(button);
    buttonContainer.className += ' bt tar pad-10';
    modalContent.dataset.edited = true;
    modalContent.append(buttonContainer);

    button.onclick = function () {
      const newText = pre.textContent.trim();

      if (!isValidJSON(newText)) {
        createSnackbar('Invalid JSON', 'Dismiss');

        return;
      }

      const oldText = templateText.trim();
      const isEdited = newText !== oldText;

      if (!isEdited) {
        createSnackbar('Nothing to update.', 'Dismiss');

        return;
      }

      sendUpdateTemplateRequest(newText);
    };
  };

  const modal = getModal({
    title: `View ${template.name}`,
    modalBodyElement: editorDiv,
  });

  document.body.appendChild(modal);
}

function manageTemplates() {
  setActionTitle('Manage Templates');
  hideActionsSection();

  const container = document.createElement('div');
  container.classList.add('pad');
  const headingContainer = document.createElement('div');
  headingContainer.className += ' tac';
  const h5 = document.createElement('h5');
  h5.className += ' ttuc bold ft-size-20';
  h5.textContent = 'Templates';
  headingContainer.append(h5);
  const ul = document.createElement('ul');
  ul.className += ' template-list';

  sendApiRequest('/json?action=view-templates')
    .then(function (response) { return response.json(); })
    .then(function (response) {
      console.log('View Templates', response);

      sessionStorage.setItem('cachedTemplates', JSON.stringify(response));

      Object
        .keys(response)
        .forEach(function (templateId) {
          const templateDoc = response[templateId];
          const li = document.createElement('li');
          li.className += ' raised flexed-column';
          const name = document.createElement('span');
          name.textContent = templateDoc.name;
          name.className += 'col-white bg-magenta bold';
          const description = document.createElement('span');
          description.textContent = templateDoc.comment;
          description.className += ' pad-10';
          const buttonsContainer = document.createElement('div');
          buttonsContainer.className += ' ml-16';

          const viewButton = document.createElement('input');
          viewButton.className += ' button';
          viewButton.type = 'button';
          viewButton.value = 'View';
          viewButton.dataset.templateId = templateId;
          viewButton.onclick = viewTemplateButtonOnClick;
          buttonsContainer.append(viewButton);

          li.append(name, description, buttonsContainer);
          ul.append(li);
        });

      container
        .append(headingContainer, ul);

      document
        .querySelector('.forms-parent')
        .append(container);
    })
    .catch(console.error);
}

function windowOnLoad() {
  const officeSelect = document.querySelector('#all-office-form');
  const cachedList = sessionStorage.getItem('officeNamesList');

  /** If the list has been cached during this session, ignore */
  if (officeSelect && !cachedList) {
    fetchOfficeList();
  }

  const phoneField = document.querySelector('#phone');

  if (phoneField) {
    phoneField.onfocus = function () {
      initializeTelInput(phoneField);

      // Required, otherwise this initialization will try to run everytime
      // the user tries to type something in the field
      phoneField.onfocus = null;
      phoneField.oninput = joinFormSelfPhoneOnInput;
    };
  }
}

function windowOnBeforeUnload() {
  if (document.body.dataset.office) {
    sessionStorage.setItem('office', document.body.dataset.office);
  }
}

// window.onload = windowOnLoad;
window
  .onbeforeunload = windowOnBeforeUnload;
window
  .addEventListener('load', windowOnLoad);
window
  .addEventListener('DOMContentLoaded', onDomContentLoaded);
