'use strict';


function searchOffice() {
  const input = document.getElementById('office-search-field');
  const ul = document.querySelector('#office-search-results-ul');
  const ulContainer = document.querySelector('#office-search-results');
  ulContainer.classList.remove('hidden');

  const errorP = document.querySelector('#error');

  if (!isNonEmptyString(input.value)) {
    errorP.classList.remove('hidden');
    errorP.textContent = 'Please enter a search term';

    return;
  }

  ul.innerHTML = '';

  errorP.classList.add('hidden');
  const spinner = getSpinnerElement().center();
  ul.appendChild(spinner);

  const url = `${apiBaseUrl}/admin/search?support=true`;

  sendApiRequest(`${url}&office=${input.value}`, null, 'GET')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {

      console.log('response', response);

      spinner.remove();

      if (response.length === 0) {
        errorP.textContent = 'No results found';
        errorP.classList.remove('hidden');

        return;
      }

      response.forEach(function (name) {
        const li = document.createElement('li')
        const span = document.createElement('span');
        span.classList.add('mdc-list-item__text');
        span.textContent = name;
        li.classList.add('mdc-list-item', 'cur-ptr');
        li.tabIndex = '0';
        li.appendChild(span);

        li.onclick = function (event) {
          input.value = name;
          // document.querySelector('.button-search').classList.add('invisible');

          // document.getElementById('continue').classList.remove('invisible');

          document.body.dataset.office = input.value;

          // Remove the div containing the 'Search an office' text
          document.querySelector('#office-search-title').remove();

          // Removes the section containing this form
          document
            .querySelector('#office-form')
            .parentElement
            .remove();

          ul.querySelectorAll('li').forEach(function (el) {
            el.remove();
          });

          // [...ul.querySelectorAll('li')].forEach(function (el) {
          //   el.remove();
          // });

          document
            .querySelector('#actions-section')
            .classList
            .remove('hidden');

          // Search bar
          document
            .querySelector('#search-box')
            .classList.remove('hidden');

          document.querySelector('#support-office-search').remove();
        }

        ul.appendChild(li)
      });
    });
}


function toggleSearchButton(e) {
  console.log(e);
  if (!e.value) {
    document.querySelector('.button-search').classList.add('invisible');
    document.getElementById('create-office').classList.remove('invisible')

  } else {
    document.querySelector('.button-search').classList.remove('invisible');
    document.getElementById('create-office').classList.add('invisible')
  }
  document.getElementById("continue").classList.add('invisible');
}

function startAdmin() {
  document.body.dataset.office = document.getElementById('office-selector').value;

  // Hide the section containing the office select
  document
    .getElementById('office-form')
    .parentElement
    .classList
    .add('hidden');
  document.querySelector('.action-icons-container').classList.remove('hidden');
}



function excelUploadContainer(template) {
  const container = document.createElement('div')
  let templateNames;

  if (template) {
    templateNames = [template]
  } else {
    templateNames = ["bill", "invoice", "material", "supplier-type", "recipient", "branch", "department", "leave-type", "subscription", "admin", "customer-type", "expense-type", "product", "employee"]
  }
  const fileContainer = document.createElement('div')
  fileContainer.id = 'file-container'
  const selectBox = customSelect('Choose Type');

  templateNames.forEach(function (name) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selectBox.querySelector('select').appendChild(option)
  })
  container.appendChild(selectBox);

  const uploadContainer = document.createElement('div')
  uploadContainer.className = 'upload-container'
  const input = document.createElement('input')
  input.type = 'file';

  input.accept = '.xlsx, .xls , .csv'

  const label = document.createElement('label')
  label.textContent = 'Upload File';
  uploadContainer.appendChild(label);
  uploadContainer.appendChild(input);

  const result = document.createElement('div')
  result.id = 'upload-result-error';
  uploadContainer.appendChild(result)

  const downloadContainer = document.createElement('div');
  downloadContainer.className = 'download-container mt-20';
  const button = document.createElement('button')
  button.className = 'button'
  button.textContent = 'Download Sample';
  downloadContainer.appendChild(button)
  fileContainer.appendChild(uploadContainer);
  fileContainer.appendChild(downloadContainer);
  container.appendChild(fileContainer)


  return container;

}


function BulkCreateErrorContainer(originalData, rejectedOnes) {
  const cont = document.getElementById('upload-result-error')
  cont.innerHTML = '';
  const frag = document.createDocumentFragment();
  if (rejectedOnes.length >= 2) {
    cont.style.height = '150px';
  }
  rejectedOnes.forEach(function (value, idx) {
    const span = document.createElement('span')
    span.textContent = 'Error at row number : ' + originalData[idx].__rowNum__
    const p = document.createElement('p')
    p.textContent = value.reason
    p.className = 'warning-label'
    frag.appendChild(span)
    frag.appendChild(p)
  })
  cont.appendChild(frag);
}

function customSelect(text) {
  const span = document.createElement('span')
  span.className = 'select-dropdown'
  const select = document.createElement('select')
  const defaultOption = document.createElement('option')
  defaultOption.selected = "true"
  defaultOption.disabled = "disabled"
  defaultOption.textContent = text
  select.appendChild(defaultOption)
  span.appendChild(select);

  return span;
}

function fileToJson(template, claim, data, modal) {
  const notificationLabel = new showLabel(modal.querySelector('#action-label'));
  let url = apiBaseUrl + '/admin/bulk';
  claim.isSupport ? url = url + '?support=true' : '';

  const wb = XLSX.read(data, {
    type: 'binary'
  });

  const ws = wb.Sheets[wb.SheetNames[0]];

  const jsonData = XLSX.utils.sheet_to_json(ws, {
    blankRows: false,
    defval: '',
    raw: false
  });

  if (!jsonData.length) return notificationLabel.warning('File is Empty');

  console.log(jsonData);

  jsonData.forEach(function (val) {
    if (val['Date Of Establishment']) {
      val['Date Of Establishment'] = moment(val['Date of Establishment']).valueOf();
    };
    val.share = [];
  })

  getLocation().then(function (location) {

    const body = {
      office: document.body.dataset.office || '',
      template: template,
      data: jsonData,
      timestamp: Date.now(),
      geopoint: location
    }

    return sendApiRequest(`${url}`, body, 'POST')
      .then(function (response) {
        return response.json();
      })
      .then(function (response) {
        const rejectedOnes = response.data.filter((val) => val.rejected);
        if (!rejectedOnes.length) return notificationLabel.success('Success')
        notificationLabel.success('')
        BulkCreateErrorContainer(jsonData, rejectedOnes)
      }).catch(console.error);
  }).catch(function (message) {
    notificationLabel.warning(message)
  });
}



function createNew() {
  let templateSelected;
  const modal = createModal(excelUploadContainer(template))

  modal.querySelector('select').addEventListener('change', function (evt) {
    templateSelected = evt.target.value
  })
  modal.querySelector('input').onchange = function (inputEvt) {
    if (!templateSelected) {
      modal.querySelector("#action-label").textContent = 'Please Select A Type'
      modal.querySelector("#action-label").classList.add('warning-label');
      return;
    }

    modal.querySelector("#action-label").textContent = ''
    inputEvt.stopPropagation();
    inputEvt.preventDefault();
    const files = inputEvt.target.files;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = function (e) {
      const data = e.target.result;

      fileToJson(templateSelected, {
        isSupport: isSupport,
        isAdmin: isAdmin
      }, data, modal)
    }
    reader.readAsBinaryString(file);

  }

  document.getElementById('modal-box').appendChild(modal);
}

function showLabel(el) {
  this.el = el;
}
showLabel.prototype.success = function (text) {
  if (!this.el) return;
  this.el.textContent = text
  this.el.className = 'success-label'
}
showLabel.prototype.warning = function (text) {
  if (!this.el) return;
  this.el.textContent = text
  this.el.className = 'warning-label'
}


function triggerReports() {
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

  function submitOnClick() {
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
      if (!Object.keys(response).length) {
        // return container.textContent = 'No Reports Found';

        throw new Error('recipients/no-reports-subscribed');
      }

      const selectBox = document.querySelector('#report-trigger-select');

      response.recipient.forEach(function (data) {
        const option = document.createElement('option')
        option.value = data.attachment.Name.value;
        option.textContent = data.attachment.Name.value;
        selectBox.appendChild(option);
      })

      const submitButton = document.querySelector('#trigger-report-button');
      submitButton.onclick = submitOnClick;
    })
    .catch(console.error);
}

function searchAndUpdate() {
  const container = document.createElement('div');
  const ul = document.createElement('ul')
  const search = searchBar('Search', 'search-all');
  // let label;

  let chooseType;
  let chooseValue;
  let editValue;
  let activtyChoosen;
  search.querySelector('button').onclick = function () {
    activtyChoosen = ''
    if (chooseType) {
      chooseType.remove();
    }
    if (chooseValue) {
      chooseValue.remove();
    }
    if (editValue) {
      editValue.remove()
    }
    if (document.getElementById('edit-values')) {
      document.getElementById('edit-values').remove();
    }
    console.log(search)
    const input = search.querySelector('input')
    let value = input.value
    if (isValidPhoneNumber(value)) {
      value = value.replace('+', '%2B')
    }

    sendApiRequest(`/json?office=${document.body.dataset.office}&query=${value}`, null, 'GET').then(function (res) {
      return res.json()
    }).then(function (response) {
      console.log(response)

      // if (response.status !== 'ok') return label.warning('Please Try Again Later')
      ul.innerHTML = '';

      console.log(response)
      const types = Object.keys(response);

      if (!types.length) {
        // label.warning('No results Found');
        return;
      }
      // label.warning('');
      chooseType = customSelect('Choose Type')
      types.forEach(function (name) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        chooseType.querySelector('select').appendChild(option)
      })
      chooseType.addEventListener('change', function (evt) {
        if (chooseValue) {
          chooseValue.remove();
        }
        if (editValue) {
          editValue.remove()
        }
        if (document.getElementById('edit-values')) {
          document.getElementById('edit-values').remove();
        }
        chooseValue = customSelect('Choose ' + evt.target.value);

        response[evt.target.value].forEach(function (value) {
          const option = document.createElement('option');
          option.value = JSON.stringify(value);
          option.textContent = value.activityName;
          chooseValue.querySelector('select').appendChild(option)
        })
        form.appendChild(chooseValue);
        chooseValue.addEventListener('change', function (evt) {
          if (editValue) {
            editValue.remove()
          }
          if (document.getElementById('edit-values')) {
            document.getElementById('edit-values').remove();
          }
          const value = JSON.parse(evt.target.value);
          activtyChoosen = value;
          editValue = customSelect('Edit  ' + value.activityName);

          Object.keys(value.attachment).forEach(function (attachmentName) {
            let option = document.createElement('option');

            option.value = attachmentName
            option.textContent = attachmentName
            editValue.querySelector('select').appendChild(option)
          })

          editValue.addEventListener('change', function (evt) {
            const editCont = document.createElement('div')
            editCont.id = 'edit-values'
            const attachmentName = evt.target.value;
            console.log(attachmentName)
            if (activtyChoosen.attachment[attachmentName].type === 'string') {
              const oldlabel = document.createElement('label')
              oldlabel.textContent = 'Current ' + attachmentName

              const input = document.createElement('input');
              input.value = activtyChoosen.attachment[attachmentName].value;
              input.style.width = '100%'
              input.disabled = 'true'
              editCont.appendChild(oldlabel);
              editCont.appendChild(input);

              const newlabel = document.createElement('label')
              newlabel.textContent = 'New ' + attachmentName

              const changeInput = document.createElement('input')
              changeInput.style.width = '100%'
              editCont.appendChild(newlabel);
              editCont.appendChild(changeInput);
              const submit = document.createElement('button')
              submit.className = 'button mt-10'
              submit.textContent = 'Submit'

              submit.onclick = function () {
                activtyChoosen.attachment[attachmentName].value = changeInput.value;

                getLocation().then(function (location) {
                  activtyChoosen.geopoint = location
                  activtyChoosen.timestamp = Date.now()

                  sendApiRequest(`${apiBaseUrl}/activities/update?support=true`, activtyChoosen, 'PATCH').then(function (res) {
                    console.log(res)
                    return res.json()
                  }).then(function (response) {
                    if (!response.success) {
                      // label.warning(response.message)
                      return;
                    }
                    // label.success('success');

                    console.log(response)
                  }).catch(console.log)
                }).catch(function (errorMessage) {
                  // label.warning(errorMessage);
                })

              }
              editCont.appendChild(submit)
              form.appendChild(editCont)
            }
            console.log(evt.target.value)
          });
          form.appendChild(editValue)
        });
      })
      form.appendChild(chooseType);

    }).catch(function (error) {
      // label.warning(error.message)
      console.error(error);
    })
  }
  const form = document.createElement('div')
  form.className = 'form-inline'
  form.appendChild(search);

  container.appendChild(form);
  container.appendChild(ul);
  // const modal = createModal(container);
  const section = document.querySelector('#search-and-update-section');
  section.classList.remove('hidden');

  section.appendChild(container);

  // document.getElementById('modal-box').appendChild(section);

  // label = new showLabel(document.getElementById('action-label'))
}

function createActivityList(data) {

}

function getPageHref() {
  return location.protocol + '//' + location.host + location.pathname + (location.search ? location.search : "")
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

function viewEnquiries() {
  const table = document.createElement('table');
  table.id = 'enquiry-table'
  table.className = 'overflow-table'
  const head = document.createElement('thead');
  const headTr = document.createElement('tr');
  const headerNames = ['S.No', 'Status', 'Creator', 'Company', 'Product', 'Enquiry'];
  headerNames.forEach(function (name) {
    const th = document.createElement('th');
    th.textContent = name
    headTr.appendChild(th);
  });

  head.appendChild(headTr);
  table.appendChild(head);
  const spinner = getSpinnerElement().center()
  const label = new showLabel(document.getElementById('action-label'));
  const templateName = 'enquiry';

  const enquiriesContainer = document.querySelector('#enquiries-container');
  enquiriesContainer.scrollIntoView({
    behavior: 'smooth',
  });

  if (window.enquiriesShownAlready) {
    return;
  }

  const spinnerContainer = document.createElement('div');
  spinnerContainer.appendChild(spinner);
  spinnerContainer.classList.add('flexed-jc-center');

  enquiriesContainer.appendChild(spinnerContainer);
  enquiriesContainer.classList.remove('hidden');

  sendApiRequest(
    `/json?template=${templateName}&office=${document.body.dataset.office}`,
    null,
    'GET'
  )
    .then(function (response) {

      if (response.ok) {
        window.enquiriesShownAlready = true;
      }

      return response.json();
    })
    .then(function (response) {
      console.log('response', response);
      if (Object.keys(response).length === 0) {
        spinner.remove();

        document
          .querySelector('#no-enquiry-box')
          .classList
          .remove('hidden');

        return;
      }

      const body = document.createElement('tbody')

      const ulContainer = document.createElement('ul');
      ulContainer.classList.add('mdc-list', 'mdc-list--two-line');

      function showEnquiryDetails(elem, record) {
        console.log('Enquiry', elem, record);
      }

      response.enquiry.forEach(function (record, index) {
        const li = getEnquiryLi(record, index);

        li.onclick = function (evt) {
          showEnquiryDetails(evt.target, record);
        };

        ulContainer.appendChild(li);
      });

      ulContainer.style.maxHeight = '400px';
      ulContainer.style.overflowX = 'auto';

      spinnerContainer.remove();
      enquiriesContainer.appendChild(ulContainer);

      // response.enquiry.forEach(function (record, index) {
      //   const tr = document.createElement('tr');
      //   const indexCol = document.createElement('td');
      //   indexCol.textContent = index + 1;
      //   const statusRow = document.createElement('td');
      //   statusRow.textContent = record.status;
      //   const creatorRow = document.createElement('td');
      // creatorRow.textContent = record.creator.displayName || response[i].creator.phoneNumber
      //   const companyRow = document.createElement('td')
      //   companyRow.textContent = record.attachment['Company Name'].value || '-';
      //   const productRow = document.createElement('td');
      //   productRow.textContent = '';

      //   if (record.attachment.Product) {
      //     productRow.textContent = record.attachment.Product.value || '-';
      //   }

      //   const enquiryRow = document.createElement('td');

      //   enquiryRow.textContent = record.attachment.Enquiry.value || '-';
      //   tr.appendChild(indexCol);
      //   tr.appendChild(statusRow);
      //   tr.appendChild(creatorRow);
      //   tr.appendChild(companyRow);
      //   tr.appendChild(productRow);
      //   tr.appendChild(enquiryRow);

      //   body.appendChild(tr)
      // });

      // table.appendChild(body);
      // spinnerContainer.remove();
      // enquiriesContainer.appendChild(table);
    });
}


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

function employeeExit() {
  // const search = searchBar('Search Employee','employee-search');
  // const input = search.querySelector('input');
  // const submit = search.querySelector('button');
  // submit.onclick = function(){

  //   sendApiRequest(`${getPageHref()}json?template=employee&office=${office}&query=${input.value}`,null,'GET').then(function(res){
  //     return res.json()
  //   }).then(function(response){
  //       console.log(response);

  //   }).catch(console.error)
  // }
  // document.getElementById('modal-box').appendChild(createModal(search))
}

function handleUpdateAuthRequest(phoneNumber, displayName, email) {
  console.log('Sending fetch request');
  const messageNode = document.getElementById('message');

  console.log('request', { phoneNumber, displayName, email });

  return sendApiRequest(
    `${apiBaseUrl}/update-auth`,
    {
      phoneNumber,
      displayName,
      email,
    },
    'POST')
    .then(function (response) {
      if (!response.ok) {
        return Promise.resolve();
      }

      return response.json();
    })
    .then(function (json) {
      console.log('result', json);

      if (!json.success) {
        messageNode.innerText = json.message;

        return;
      }

      messageNode.classList.remove('warning-label');
      messageNode.classList.add('success-label');
      messageNode.innerText = json.message
        || 'Auth updated successfully...';
      messageNode.classList.remove('hidden');

      return;
    })
    .catch(function (error) {
      console.error(error);
    });
}

function updateAuth() {
  console.log('Update auth called');
  const message = document.createElement('p');
  message.classList.add('warning-label', 'mb-8', 'hidden');
  message.id = 'message';
  const actionContent = document.createElement('form');
  actionContent.id = 'update-auth-form';
  actionContent.classList.add('flexed', 'pad');
  actionContent.style.flexDirection = 'column';

  const modalTitle = document.createElement('h2');
  const phoneNumberInput = document.createElement('input');
  phoneNumberInput.id = 'phoneNumberInput';
  const displayNameInput = document.createElement('input');
  displayNameInput.id = 'displayNameInput';
  const emailInput = document.createElement('input');
  emailInput.id = 'emailInput';
  displayNameInput.classList.add('input-field', 'mb-8');
  displayNameInput.placeholder = 'Person Name';
  modalTitle.innerText = 'Update Auth';
  phoneNumberInput.classList.add('input-field', 'mb-8');
  phoneNumberInput.placeholder = '(+91) phone number';
  emailInput.placeholder = 'Email';

  emailInput.classList.add('input-field', 'mb-8');

  const a = document.createElement('a');
  a.classList.add('button');
  a.innerText = 'Update Email';

  a.onclick = function () {
    console.log('on click called');
    const phoneNumber = document.getElementById('phoneNumberInput').value;

    if (!isValidPhoneNumber(phoneNumber)) {
      message.innerText = 'Invalid Phone Number';
      message.classList.remove('hidden');

      return;
    }

    const displayName = document.getElementById('displayNameInput').value;

    if (!isNonEmptyString(displayName)) {
      message.innerText = 'Invalid display name';

      message.classList.remove('hidden');

      return;
    }

    const email = document.getElementById('emailInput').value;

    if (!isValidEmail(email)) {
      message.innerText = 'Invalid email';

      message.classList.remove('hidden');

      return;
    }

    return handleUpdateAuthRequest(
      phoneNumber,
      displayName,
      email
    );
  };

  actionContent.appendChild(modalTitle);
  actionContent.appendChild(message);
  actionContent.appendChild(phoneNumberInput);
  actionContent.appendChild(displayNameInput);
  actionContent.appendChild(emailInput);
  actionContent.appendChild(a);

  const modal = createModal(actionContent);
  document.getElementById('modal-box').appendChild(modal)
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

window.onload = function () {
  const joinContainer = document.querySelector('.join-container');

  if (document.body.dataset.isadmin || document.body.dataset.issupport) {
    if (joinContainer) {
      joinContainer.classList.add('hidden');
    }
  }

  if (document.body.dataset.isadmin
    && sessionStorage.getItem('office')
    && firebase.auth().currentUser) {
    document.body.dataset.office = sessionStorage.getItem('office');


    // remove the office search section
    document
      .querySelector('#actions-section')
      .classList
      .remove('hidden');
  }

  if (document.body.dataset.istemplatemanager) {
    document
      .querySelector('#actions-section')
      .classList
      .remove('hidden');
  }

  const phoneField = document.querySelector('#phone');

  if (phoneField) {
    phoneField.onfocus = function () {
      const intlTelInputOptions = {
        preferredCountries: ['IN', 'NP'],
        initialCountry: 'IN',
        nationalMode: false,
        formatOnDisplay: true,
        customContainer: 'mb-16',
        customPlaceholder: function (selectedCountryPlaceholder, selectedCountryData) {
          window.countryCode = selectedCountryData.dialCode;
          console.log({ selectedCountryPlaceholder, selectedCountryData });
          return "e.g. " + selectedCountryPlaceholder;
        }
      };

      const altContact = document.querySelector('#alt-contact');
      phoneField.style.height = '58px';
      phoneField.classList.add('mw-100');
      altContact.style.height = '58px';
      altContact.classList.add('mw-100');

      window.intlTelInput(phoneField, intlTelInputOptions);
      window.intlTelInput(altContact, intlTelInputOptions);

      // Required, otherwise this initialization will try to run everytime
      // the user tries to type something in the field
      phoneField.onfocus = null;
    }
  }
};

window.onbeforeunload = function () {
  if (document.body.dataset.office) {
    sessionStorage.setItem('office', document.body.dataset.office);
  }
}
