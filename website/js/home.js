/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

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

function addBreadCrumb(breadcrumbName) {
  const ul = document.querySelector('.breadcrumbs ul');
  const li = document.createElement('li');
  li.onclick = function () {
    const lastLi = ul.lastElementChild;
    if (lastLi == li) return;
    document.getElementById('actions-section').classList.remove('hidden');
    const formsParent = document.querySelector('.forms-parent');
    formsParent.classList.remove('pad');
    removeAllChildren(formsParent);
    ul.removeChild(ul.lastElementChild);
  };
  const a = document.createElement('a');
  a.textContent = breadcrumbName;
  li.appendChild(a);
  ul.appendChild(li);
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
  addBreadCrumb(office);
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
    .catch(function (error) {
      createSnackbar(error);
    });
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
    .catch(function (error) {
      createSnackbar(error);
    });
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
    oldPhoneNumber: getPhoneNumber('old-phone-number'),
    newPhoneNumber: getPhoneNumber('new-phone-number'),
    office: document.body.dataset.office,
  };

  let requestUrl = `${apiBaseUrl}/admin/change-phone-number`;

  if (isSupport()) {
    requestUrl += '?support=true';
  }

  console.log('requestBody', requestBody);

  sendApiRequest(requestUrl, requestBody, 'POST')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      createSnackbar(response.message || 'Phone Number updated successfully');
    })
    .catch(function (error) {
      createSnackbar(error);
    });
}

function handleUpdateAuthRequest() {
  const form = document.querySelector('.forms-parent');
  const phoneNumber = getPhoneNumber('verify-email-number');
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
      `${apiBaseUrl}/update-auth`, {
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

      createSnackbar(response.message || 'Success');
    })
    .catch(function (error) {

      createSnackbar(error);
    });
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
    .catch(function (error) {
      createSnackbar(error);
    });
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
      value = formatPhoneNumber(value);
      // if (!value.startsWith(window.countryCode)) {
      //   value = `+${window.countryCode}${value}`;
      // }
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
      createSnackbar(error);
    });
}

function showActivityCancellationWarning(doc) {
  const modalBodyElement = document.createElement('div');
  modalBodyElement.className += 'pad';

  const p = document.createElement('p');
  p.textContent = `You are about to cancel` +
    ` ${doc.activityName}`;

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
  };


  document.body.appendChild(modal);
}

function sendActivityStatusChangeRequest(doc, newStatus) {
  const requestBody = (function () {
    if (doc.template === 'employee') {
      return {
        office: document.body.dataset.office,
        phoneNumber: (() => {
          if (doc.attachment['Phone Number']) {
            return doc.attachment['Phone Number'].value;
          }

          return doc.attachment['Employee Contact'].value;
        })(),
      };
    }

    return {
      activityId: doc.activityId,
      status: newStatus,
      timestamp: Date.now(),
      geopoint: {},
    };
  })();

  if (newStatus === 'CANCELLED' &&
    !window.warningShownAlready) {
    showActivityCancellationWarning(doc);

    return;
  }

  let requestUrl = (function () {
    if (doc.template === 'employee' && newStatus === 'CANCELLED') {
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

      return sendApiRequest(`${requestUrl}`, requestBody, 'PATCH');
    })
    .then(function (response) {
      return response.json();
    })
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

function addAssigneeToActivity(doc) {
  const modalBodyElement = document.createElement('div');
  const button = getButton('Submit');
  const form = document.createElement('form');
  form.classList.add('pad', 'flexed-column', 'pad');
  const phoneInput = document.createElement('input');
  phoneInput.type = 'tel';
  phoneInput.classList.add('input-field', 'mw-100');

  form.append(phoneInput, button);

  modalBodyElement.append(form);

  const modal = getModal({
    title: `Add new phone number to ${doc.activityName}`,
    modalBodyElement,
  });

  document.body.append(modal);

  initializeTelInput(phoneInput);

  button.onclick = function () {
    const value = formatPhoneNumber(phoneInput.value);

    if (!isValidPhoneNumber(value)) {
      return createSnackbar('Invalid phone number');
    }

    let requestUrl = `${apiBaseUrl}/activities/share`;

    if (isSupport()) {
      requestUrl += '?support=true';
    }

    const requestBody = {
      activityId: doc.activityId,
      timestamp: Date.now(),
      share: [value],
    };

    getLocation()
      .then(function (geopoint) {
        requestBody.geopoint = geopoint;

        return sendApiRequest(requestUrl, requestBody, 'PATCH');
      })
      .then(function (response) {
        return response.json();
      })
      .then(function (response) {
        console.log('Response', response);

        createSnackbar(response.message || 'New phone number added');

        if (response.success) {
          closeModal();
        }
      })
      .catch(function (error) {
        createSnackbar(error || 'Something went wrong');
      });
  };
}

function getActivityEditForm(doc) {
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
      const {
        type,
        value
      } = doc.attachment[field];

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

        input.value = value || false;
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

      if (field === 'Name' ||
        field === 'Number') {
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
      const {
        name,
        startTime,
        endTime
      } = item;

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

  assigneeUl.classList.add('mdc-chip-set');

  doc
    .assignees
    .forEach(function (phoneNumber, index) {
      const li = document.createElement('li');
      const phoneSpan = document.createElement('span');
      phoneSpan.textContent = phoneNumber;
      phoneSpan.classList.add('mdc-chip__text');
      li.classList.add('mdc-chip');

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
  buttonContainer.classList.add('flexed', 'pad-10', 'activity-buttons', 'flexed-center');
  const updateButton = getButton('Update');
  const confirmButton = getButton('Confirm', true);
  const cancelButton = getButton('Cancel', true);
  const pendingButton = getButton('Pending', true);
  const addNewAssigneeButton = getButton('Add New', true);

  confirmButton
    .onclick = function () {
      sendActivityStatusChangeRequest(doc, 'CONFIRMED');
    };
  cancelButton
    .onclick = function () {
      sendActivityStatusChangeRequest(doc, 'CANCELLED');
    };
  pendingButton
    .onclick = function () {
      sendActivityStatusChangeRequest(doc, 'PENDING');
    };

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

  // cannot change status for employee and subscription activities
  if (doc.status === 'CANCELLED' &&
    doc.template !== 'employee' &&
    doc.template !== 'subscription') {
    buttonContainer.append(confirmButton, pendingButton);
  }

  addNewAssigneeButton.onclick = function () {
    addAssigneeToActivity(doc);
  };

  buttonContainer.append(addNewAssigneeButton);

  return {
    form,
    buttonContainer
  };
}

function activityEditOnClick(doc) {
  const container = document.querySelector('.single-activity');

  removeAllChildren(container);

  const elements = getActivityEditForm(doc);
  container.className += ` raised`;

  // container.appendChild(dataContainer);
  container.append(elements.form, elements.buttonContainer);

  elements
    .form
    .querySelectorAll('input[type="tel"]').forEach(el => {
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

function filterResultsForSearchAndUpdate() {
  const modalBodyElement = document.createElement('div');
  modalBodyElement.classList.add('pad-10');

  const fieldsContainer = document.createElement('div');
  const fieldSelect = document.createElement('select');

  window
    .searchTemplateAttachmentFields
    .forEach(function (fieldItem) {
      const option = document.createElement('option');

      option.textContent = fieldItem.field;

      fieldSelect.append(option);
    });

  fieldSelect.className += ' input-field mb-16 mw-100';

  const input = document.createElement('input');
  input.classList.add('input-field', 'mw-100', 'mb-16');
  input.placeholder = 'Type here...';

  fieldsContainer.append(fieldSelect, input);

  const buttonContainer = document.createElement('div');
  buttonContainer.style.textAlign = 'right';
  const button = getButton('Submit');

  button.onclick = function () {
    console.log('init search');
    if (!input.value) {
      return createSnackbar('Invalid input');
    }

    closeModal();

    const template = document.querySelector('.forms-parent select').value;

    let requestUrl = `/json?office=${encodeURIComponent(document.body.dataset.office)}` +
      `&attachmentField=${fieldSelect.value}` +
      `&query=${encodeURIComponent(input.value)}` +
      `&template=${template}`;

    if (isSupport()) {
      requestUrl += '&support=true';
    }

    console.log(requestUrl);

    sendApiRequest(requestUrl)
      .then(function (response) {
        return response.json();
      })
      .then(function (response) {

        /** Calling this function to repopulate the activity list */
        searchUpdateTemplateSelectOnChange(requestUrl, template);

        console.log('Response', response);
      })
      .catch(function (error) {
        return createSnackbar(error || 'Something went wrong');
      });
  };

  buttonContainer.append(button);

  modalBodyElement.append(fieldsContainer, buttonContainer);

  const modal = getModal({
    title: 'Filter activities',
    modalBodyElement,
  });

  document.body.appendChild(modal);
}

function searchUpdateTemplateSelectOnChange(url) {
  const templateSelect = document.querySelector('.forms-parent select');
  const selectedTemplate = templateSelect.value;

  if (!selectedTemplate) return;
  const activityFilter = document.querySelector('.activity-filter');
  activityFilter.classList.remove('hidden');

  const ul = document.querySelector('.activity-list');

  removeAllChildren(ul);

  // single-activity
  removeAllChildren(document.querySelector('.single-activity'));

  // activity-form
  // removeAllChildren(document.querySelector('.activity-form'));

  sendApiRequest(url)
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('response', response);
      const keys = Object.keys(response);
      if (!keys.length) {
        createSnackbar('No ' + selectedTemplate + ' Found');
        return;
      }

      keys
        .forEach(function (key, index) {

          const doc = response[key];

          /** For generating the dynamic select list in modal. */
          if (index === 0) {
            window
              .searchTemplateAttachmentFields = Object
              .keys(doc.attachment)
              .map(function (field) {
                return ({
                  field,
                  value: doc.attachment[field].value,
                  type: doc.attachment[field].type,
                });
              });
          }

          const li = getActivityListItem(doc);

          if (index === 0) {
            li.tabIndex = 0;
          }
          activityFilter.onclick = filterResultsForSearchAndUpdate;
          ul.appendChild(li);
        });
    })
    .catch(console.error);
}

function searchAndUpdate() {
  addBreadCrumb('Search & Update');
  hideActionsSection();

  const container = document.querySelector('.forms-parent');

  container.classList += ' pad';

  const listOfTemplates = document.createElement('select');
  const loadingOption = document.createElement('option');
  loadingOption.textContent = 'Loading...';
  listOfTemplates.append(loadingOption);

  const activityDiv = document.createElement('div');

  activityDiv.className += ' activity-parent';

  const listOfActivities = document.createElement('ul');
  const singleActivity = document.createElement('div');

  listOfActivities.classList += ' activity-list';
  singleActivity.classList.add('single-activity');
  listOfTemplates.className += ' input-field w-100';

  const filterDiv = document.createElement('div');
  const searchIcon = document.createElement('i');
  searchIcon.textContent = 'search';
  searchIcon.classList.add('material-icons');

  filterDiv.append(searchIcon);
  filterDiv.className = 'cur-ptr activity-filter hidden';

  const listContainer = document.createElement('div');
  listContainer.className += 'activity-list-container';
  listContainer.append(filterDiv, listOfActivities);

  activityDiv.append(listContainer, singleActivity);
  container.append(listOfTemplates, activityDiv);

  sendApiRequest('/json?action=get-template-names')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('Response', response);

      listOfTemplates.firstElementChild.remove();
      const defaultOption = document.createElement('option');

      defaultOption.textContent = 'Select a template';
      defaultOption.value = '';

      listOfTemplates.append(defaultOption);

      response.forEach(function (name) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;

        listOfTemplates.appendChild(option);
      });

      listOfTemplates.onchange = function () {
        const templateSelect = document.querySelector('.forms-parent select');
        const url = `/json?office=${document.body.dataset.office}` +
          `&template=${templateSelect.value}`;

        searchUpdateTemplateSelectOnChange(url, templateSelect.value);
      };
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



function populateTemplateSelect(selectElement, defaultValue) {
  document
    .getElementById('download-sample')
    .addEventListener('click', function (evt) {
      evt.preventDefault();

      sendApiRequest(`/json?action=view-templates&name=${selectElement.value}`)
        .then(function (response) {
          return response.json();
        })
        .then(function (response) {
          const key = Object.keys(response)[0];
          createExcelSheet(response[key]);

        }).catch(console.error);
    });

  selectElement.onchange = function () {
    removeAllChildren(document.querySelector('.bc-results-list'));

    document.querySelector('.bc-results').classList.add('hidden');
    document
      .querySelector('.bc-file-drag')
      .classList
      .remove('hidden');

    document
      .querySelector('.bc-container')
      .style
      .minHeight = '200px';
  };
  selectElement.value = defaultValue;
  selectElement.onchange();

}

function createExcelSheet(rawTemplate) {
  var wb = XLSX.utils.book_new();
  wb.props = {
    Title: rawTemplate.name,
    Subject: `${rawTemplate.name} sheet`,
    Author: 'Growthfile',
    CreatedDate: new Date()
  };

  const data = [];

  if (rawTemplate.name === 'customer' ||
    rawTemplate.name === 'branch') {
    data.push(['address', 'location']);
  } else {
    const allKeys = Object.keys(rawTemplate.attachment);

    rawTemplate
      .schedule
      .forEach(function (name) {
        allKeys.push(name);
      });
    rawTemplate
      .venue
      .forEach(function (venueDescriptor) {
        allKeys.push(venueDescriptor);
      });

    data.push(allKeys);


    // rawTemplate.schedule.forEach(function (name) {
    //   data.push(name);
    // });
  }

  const ws = XLSX.utils.aoa_to_sheet(data);

  console.log(ws);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet");
  const about = XLSX.write(wb, {
    bookType: 'xlsx',
    type: 'binary'
  });
  XLSX.writeFile(wb, rawTemplate.name + '.xlsx');

}

function getBulkCreateResultLi(item, originalJson, index) {
  const container = document.createElement('li');
  if (!index) {
    container.tabIndex = 0;
  }

  container.classList.add('flexed-column', 'raised');
  const firstRow = document.createElement('span');
  const secondRow = document.createElement('span');
  const thirdRow = document.createElement('span');
  firstRow.textContent = item.Name || item['Phone Number'];

  if (item.rejected) {
    container.classList.add('failure');
    const rowNumber = originalJson[index].__rowNum__ + 1;
    if (item.reason) {
      secondRow.textContent = 'Reason: ' + item.reason;
    }

    thirdRow.textContent = 'Result: Error at row number ' + rowNumber;
  } else {
    container.classList.add('success');
    thirdRow.textContent = 'Result: Success';
  }
  container.append(firstRow, secondRow, thirdRow);

  return container;
}

function setMessageForBulkCreate(totalSent, totalCreated, totalRejected) {
  const resultHeading = document.getElementById('result-meta');
  const metaDetail = `<div class='result-row'>
  <div class='result-column'>Total Records :  ${totalSent}</div>
  <div class='result-column'> Created  : ${totalCreated}</div>
  <div class='result-column'>Not Created : ${totalRejected}</div>

  </div>`;
  resultHeading.innerHTML = metaDetail;
}

function populateBulkCreationResult(response, originalJson) {
  document
    .querySelector('.bc-results')
    .classList
    .remove('hidden');
  const ul = document.querySelector('.bc-results-list');

  removeAllChildren(ul);

  let totalRejected = 0;
  let totalCreated = 0;

  if (response.message) {
    createSnackbar(response.message);

    return;
  }

  response.data.forEach(function (item, index) {
    if (item.rejected) {
      totalRejected += 1;
    } else {
      totalCreated += 1;
    }

    const li = getBulkCreateResultLi(item, originalJson, index);

    ul.appendChild(li);
  });

  setMessageForBulkCreate(originalJson.length, totalCreated, totalRejected);
}


function sendBulkCreateJson(result, templateName) {
  let requestUrl = `${apiBaseUrl}/admin/bulk`;

  if (isSupport()) {
    requestUrl += `?support=true`;
  }

  let isCreateOffice = false;

  if (templateName === 'office') {
    isCreateOffice = true;
  }

  const requestBody = {
    timestamp: Date.now(),
    office: isCreateOffice ? '' : document.body.dataset.office,
    data: result, // binary string
    // data: fd,
    template: templateName
  };

  getLocation()
    .then(function (location) {
      requestBody.geopoint = location;
      return sendApiRequest(requestUrl, requestBody, 'POST');
    })
    .then(function (response) {
      document
        .querySelector('.bc-results')
        .classList
        .remove('hidden');
      return response.json();
    })
    .then(function (response) {
      removeFileSpinner();
      // console.log(response)
      // populateBulkCreationResult(response, jsonData);

      // if (isCreateOffice) {
      //   let currentCachedOfficelist = sessionStorage.getItem('officeNamesList')
      //   jsonData.forEach(function (item) {
      //     if (!item.rejected) {
      //       currentCachedOfficelist += `,${item.Name}`
      //     }
      //   })

      //   sessionStorage.setItem('officeNamesList', currentCachedOfficelist);
      // }

      createSnackbar(response.message || `File Uploaded. Check your email for the results`);

      console.log('response', response);
    })
    .catch(function (error) {
      console.log(error);
      createSnackbar(error.message);
      removeFileSpinner();
    });
}

function showFileSpinner() {
  const parent = document.querySelector('.bc-file-drag');
  parent.appendChild(getSpinnerElement('file-upload-spin').center());
  parent.querySelector('i').classList.add('hidden');
}

function removeFileSpinner() {
  if (document.getElementById("file-upload-spin")) {
    document.getElementById("file-upload-spin").remove();
    document.querySelector('.bc-file-drag i').classList.remove('hidden');
  }
}

function handleExcelOrCsvFile(element, templateName) {
  showFileSpinner();

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

    if (Object.keys(jsonData).length === 0) {
      return createSnackbar('Invalid Excel file');
    }

    console.log(jsonData);

    sendBulkCreateJson(event.target.result, templateName);
    element.target.value = null;
  };
}

function bulkdCreateDom() {
  return `<div class="pad bc-container">
  <select class="input-field mb-16 mw-100" id="create-new-template-select">
      <option value="">Loading...</option>
  </select>
  <form>
      <p>Drag a file here to upload</p>
      <div class="bc-file-drag hidden raised pad-10 tac">
          <i class="fas fa-cloud-upload-alt ft-60"></i>
          <input type="file" accept=".csv,.xlsx,.xls" data-maxsize="2M" id='bulk-upload'>
      </div>
      <p>Or</p>
    <a class='button' id='download-sample' >Download Sample</a>
  </form>
  <div class="bc-results hidden mt-16">
      <div id='result-meta'>
      </div>
      <div>
          <ul class="bc-results-list"> </ul>
      </div>
  </div>
</div>`;
}

function bulkCreate() {
  addBreadCrumb('Create New');
  hideActionsSection();
  const formParent = document.querySelector('.forms-parent');
  formParent.innerHTML = bulkdCreateDom();

  const selectElement = document.getElementById('create-new-template-select');
  sendApiRequest(`/json?action=get-template-names`)
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      if (!Array.isArray(response)) {
        createSnackbar('No Subscriptions Found');
        return;
      }
      selectElement.firstElementChild.remove();
      addOptionToSelect(response, selectElement);
      populateTemplateSelect(selectElement, response[0]);
      const fileDragInput = document.getElementById('bulk-upload');
      fileDragInput.onchange = function (event) {
        handleExcelOrCsvFile(event, selectElement.value);
      };
    }).catch(console.error);
}


function addNewOffice() {
  addBreadCrumb('Create New Office');
  document.getElementById('support-office-search').remove();
  const formParent = document.querySelector('.forms-parent');
  formParent.innerHTML = bulkdCreateDom();

  const selectElement = document.getElementById('create-new-template-select');
  selectElement.classList.add('hidden');
  selectElement.firstElementChild.remove();

  addOptionToSelect(['office'], selectElement);
  populateTemplateSelect(selectElement, 'office');

  const fileDragInput = document.getElementById('bulk-upload');
  fileDragInput.onchange = function (event) {
    handleExcelOrCsvFile(event, selectElement.value);
  };

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
    // if (!isValidPhoneNumber(elem.value)) {
    //   return;
    // }

    toAdd.add(elem.value);
    allPhoneNumbers.add(elem.value);
  });

  console.log('toAdd', toAdd);
  console.log('toRemove', toRemove);
  console.log('allPhoneNumbers', Array.from(allPhoneNumbers.values()));

  const final = new Set();

  allPhoneNumbers.forEach(function (phoneNumber) {
    if (toRemove.has(phoneNumber)) {
      return;
    }

    final.add(formatPhoneNumber(phoneNumber));
  });

  const finalAssignees = Array.from(final);

  console.log({
    finalAssignees
  });

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
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      createSnackbar(response.message || 'Update Successful');
    })
    .catch(function (error) {
      createSnackbar(error);
    });
}

function recipientActivityAddMoreOnClick(evt) {
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
    li.classList.add('mdc-chip');
    const span = document.createElement('span');
    span.classList.add('mdc-chip__text');
    span.textContent = phoneNumber;
    span.dataset.phoneNumber = true;
    const icon = document.createElement('i');
    icon.classList.add('far', 'fa-times-circle', 'mdc-chip__icon', 'mdc-chip__icon--leading');
    li.append(icon, span);

    li.onclick = function () {
      span.classList.toggle('striked');

      if (buttonContainer.classList.contains('hidden')) {
        buttonContainer.classList.remove('hidden');
      }
    };

    list.appendChild(li);
  });

  list.classList.add('mdc-chip-set');

  const addPhoneNumberIcon = document.createElement('i');
  addPhoneNumberIcon.className = 'fas fa-plus ft-size-20';

  const addMore = document.createElement('div');

  addMore.classList.add('pad-10', 'tac', 'border', 'cur-ptr');
  addMore.append(addPhoneNumberIcon);
  container.append(heading, list, addMore, buttonContainer);
  addMore.onclick = recipientActivityAddMoreOnClick;
  container.className += ' raised pad mb-16';

  return container;
}

function handleRecipientSelectOnChange(evt) {
  const requestUrl = `/json?` +
    `action=${document.body.dataset.office}` +
    `&template=${evt.target.value}`;

  sendApiRequest(requestUrl)
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('Response', response);
    })
    .catch(function (error) {
      createSnackbar(error);
    });
}

function updateEmailInReports() {
  console.log('Update Email in reports clicked');
  addBreadCrumb('Update Report Emails');
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


  const requestUrl = `/json?template=recipient` +
    `&office=${document.body.dataset.office}`;

  console.log('RequestSent', requestUrl);
  sendApiRequest(requestUrl)
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('Response', response);

      Object
        .keys(response)
        .forEach(function (activityId) {
          const doc = response[activityId];

          div.appendChild(getRecipientActivityContainer(doc));
        });
    })
    .catch(function (error) {

      createSnackbar(error);
    });
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
  addBreadCrumb('Verify Email Addresses');
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
  phoneInput.id = 'verify-email-number';
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
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      console.log('Response', response);

      if (!response.success) {
        triggerResult.classList.add('warning-label');
      }

      triggerResult.textContent = response.message ||
        'Report triggered successfully';

    })
    .catch(function (error) {
      createSnackbar(error);
    });
}

function triggerReports() {
  addBreadCrumb('Trigger Reports');
  hideActionsSection();

  const hiddenReports = {
    'footprints': true
  };
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

  const submit = document.createElement('input');
  submit.type = 'button';
  submit.value = 'Submit';
  // submit.classList.add('button');
  submit.className += ' button mt-16';
  submit.style.marginLeft = 'auto';
  submit.style.marginRight = 'auto';

  const form = document.createElement('form');

  form.className += 'pad raised flexed-column hidden';

  const head = document.createElement('div');
  const h5 = document.createElement('h5');
  h5.classList += ' ttuc bold';
  h5.textContent = 'Trigger Reports';
  const description = document.createElement('p');
  description.textContent = '';
  description.className += ` col-gray`;

  head.append(h5, description);

  head.classList.add('tac');
  form.append(select, dateInput, submit);
  container.append(head, form);
  document
    .querySelector('.forms-parent')
    .append(container);

  const requestUrl = `/json?template=recipient` +
    `&office=${document.body.dataset.office}`;

  sendApiRequest(requestUrl, null, 'GET')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {


      const nonCancelledReports = [];
      Object.keys(response).forEach(function (id) {
        if (hiddenReports[response[id].attachment.Name.value]) return;
        if (response[id].status === 'CANCELLED') return;
        nonCancelledReports.push(response[id]);
      });

      if (!nonCancelledReports.length) {
        description.textContent = 'No Reports Found';
        description.classList.add('error');
        return;
      }
      description.textContent = 'Select a date to get reports to your email';
      form.classList.remove('hidden');

      nonCancelledReports
        .forEach(function (item) {
          const option = document.createElement('option');
          option.value = item.attachment.Name.value;
          option.textContent = item.attachment.Name.value;
          select.appendChild(option);
        });

      submit.onclick = recipientSubmitOnClick;
    })
    .catch(function (error) {


      createSnackbar(error);
    });
}

function changePhoneNumber() {
  addBreadCrumb('Change Phone Number');
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
  oldInput.id = 'old-phone-number';
  oldInput.className += ' input-field';

  const newInput = document.createElement('input');
  newInput.type = 'tel';


  newInput.className += ' input-field';
  newInput.id = 'new-phone-number';
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
    .then(function (response) {
      return response.json();
    })
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
    .catch(function (error) {
      createSnackbar(error);
    });
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
  addBreadCrumb('Manage Templates');
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
    .then(function (response) {
      return response.json();
    })
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
    .catch(function (error) {
      createSnackbar(error);
    });
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

window
  .onbeforeunload = windowOnBeforeUnload;
window
  .addEventListener('load', windowOnLoad);
window
  .addEventListener('DOMContentLoaded', onDomContentLoaded);
