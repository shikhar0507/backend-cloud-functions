console.log('home loaded');
let office;
const section = document.getElementById('action-section');

function searchOffice() {
  document.getElementById('continue').classList.add('invisible');
  document.getElementById('create-office').classList.add('invisible')
  const url = `${apiBaseUrl}/admin/search?support=true`
  const input = document.getElementById('office-search-field')
  const ul = document.querySelector('#office-search-form ul')
  ul.innerHTML = ''
  ul.appendChild(getSpinnerElement().center())

  sendApiRequest(`${url}&office=${input.value}`, null, 'GET')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {

      console.log('response', response);
      ul.innerHTML = ''
      if (!response.length) {
        const li = document.createElement('li')
        li.textContent = 'No Office Found';
        ul.appendChild(li);
        return;
      }

      response.forEach(function (name) {
        const li = document.createElement('li')
        li.textContent = name;
        li.onclick = function () {
          input.value = name;
          document.querySelector('.button-search').classList.add('invisible');

          document.getElementById('continue').classList.remove('invisible');

          [...ul.querySelectorAll('li')].forEach(function (el) {
            el.remove();
          });
        }
        ul.appendChild(li)
      });


    })
  console.log('clicked')
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

function startAdmin(officeName) {
  office = officeName;
  document.getElementById('office-search-form').classList.add('hidden');
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

function createTriggerReportContainer() {

  const container = document.createElement('form')
  container.className = 'form-inline';
  container.style.textAlign = 'center';

  const reportSelection = document.createElement('div')
  reportSelection.id = 'select-report-container'


  const startDateLabel = document.createElement('label')
  startDateLabel.textContent = 'From'
  const startDateInput = document.createElement('input');
  startDateInput.type = 'date';
  startDateInput.value = moment().format('DD/MM/YYYY');
  startDateInput.id = 'start-time'
  startDateInput.style.width = '100%'
  startDateInput.className = 'input-field'
  const endDateLabel = document.createElement('label')
  endDateLabel.textContent = 'To';
  const endDateInput = document.createElement('input')
  endDateInput.type = 'date'
  endDateInput.value = moment().format('DD/MM/YYYY');
  endDateInput.id = 'end-time'
  endDateInput.style.width = '100%'
  endDateInput.className = 'input-field'

  const triggerButton = document.createElement('a')
  triggerButton.className = 'button mt-10 hidden'
  triggerButton.textContent = 'Trigger'
  triggerButton.id = 'trigger-report'
  let reportSelected;
  const selectBox = customSelect('Select Report')
  const templateName = 'recipient'
  sendApiRequest(`${getPageHref()}json?template=${templateName}&office=${office}`, null, 'GET').then(function (response) {
    return response.json();
  })
    .then(function (response) {

      if (!Object.keys(response).length) return container.textContent = 'No Reports Found';


      response.recipient.forEach(function (data) {

        const option = document.createElement('option')
        option.value = data.attachment.Name.value;
        option.textContent = data.attachment.Name.value;
        selectBox.querySelector('select').appendChild(option)
      })

    })
  reportSelection.appendChild(selectBox)
  container.appendChild(reportSelection)
  container.appendChild(startDateLabel)
  container.appendChild(startDateInput)
  container.appendChild(endDateLabel)
  container.appendChild(endDateInput)

  container.appendChild(triggerButton)
  const recap = document.createElement('div');
  recap.id = 'recaptcha-container';
  recap.className = 'mt-10'
  container.appendChild(recap)
  return container;
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
      office: office || '',
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



function addNew(isSupport, isAdmin, template) {
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

  const modal = createModal(createTriggerReportContainer())
  const label = new showLabel(modal.querySelector('#action-label'))

  let selectedReport;
  modal.querySelector('select').addEventListener('change', function (evt) {
    selectedReport = evt.target.value
  });
  document.getElementById('modal-box').appendChild(modal);

  window.recaptchaVerifier = handleRecaptcha();
  recaptchaVerifier.render();
  recaptchaVerifier.verify().then(function (token) {
    console.log(token)
    modal.querySelector('#trigger-report').classList.remove('hidden');
    document.getElementById('recaptcha-container').classList.add('hidden');
    modal.querySelector('#trigger-report').onclick = function () {
      if (!selectedReport) {
        label.warning('Select A report')
        return;
      }
      const startTime = moment(modal.querySelector('#start-time').value).valueOf()
      const endTime = moment(modal.querySelector('#end-time').value).valueOf()
      if (!startTime) {
        label.warning('Select A Start Time')
        return;
      }
      if (!endTime) {
        label.warning('Select An End Time')
        return;
      }

      label.success('')
      sendApiRequest(`${apiBaseUrl}/admin/trigger-report`, {
        office: office,
        report: selectedReport,
        startTime: startTime,
        endTime: endTime
      }, 'POST').then(function (response) {
        return response.json();
      })
        .then(function (response) {
          if (response.success) {
            label.success(`${selectedReport} successfully triggered`)
          } else {
            label.warning('Please Try Again Later');
          }
        }).catch(function (error) {
          label.warning('Please Try again Later')
        })
    }
  }).catch(function (error) {
    label.warning(error.message)
  })
}

function searchAndUpdate() {
  const container = document.createElement('div');
  const ul = document.createElement('ul')
  const search = searchBar('Search', 'search-all');
  let label;

  let chooseType;

  search.querySelector('button').onclick = function () {
    if (chooseType) {
      chooseType.remove();
    }
    console.log(search)
    const input = search.querySelector('input')
    let value = input.value
    if (isValidPhoneNumber(value)) {
      value = value.replace('+', '%2B')
    }

    sendApiRequest(`${getPageHref()}/json?office=${office}&query=${value}`, null, 'GET').then(function (res) {
      return res.json()
    }).then(function (response) {
      console.log(response)
      // if (response.status !== 'ok') return label.warning('Please Try Again Later')
      ul.innerHTML = '';

      console.log(response)
      const types = Object.keys(response);

      let chooseValue;
      let editValue;
      let activtyChoosen;
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
                      label.warning(response.message)
                      return;
                    }
                    label.success('success');

                    console.log(response)
                  }).catch(console.log)
                }).catch(function (errorMessage) {
                  label.warning(errorMessage);
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
      label.warning(error.message)
    })
  }
  const form = document.createElement('div')
  form.className = 'form-inline'
  form.appendChild(search);

  container.appendChild(form);
  container.appendChild(ul);
  const modal = createModal(container);
  document.getElementById('modal-box').appendChild(modal);
  label = new showLabel(document.getElementById('action-label'))
}

function createActivityList(data) {

}

function getPageHref() {
  return location.protocol + '//' + location.host + location.pathname + (location.search ? location.search : "")

}

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
  })
  head.appendChild(headTr);
  table.appendChild(head);
  const spinner = getSpinnerElement().center()
  document.getElementById('modal-box').appendChild(createModal(spinner));
  const label = new showLabel(document.getElementById('action-label'));
  const templateName = 'enquiry'
  sendApiRequest(`${getPageHref()}json?template=${templateName}&office=${office}`, null, 'GET')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {

      if (!Object.keys(response).length) {
        spinner.remove();
        return label.warning('No enquiries found.');

      }
      const body = document.createElement('tbody')

      response.enquiry.forEach(function (record, idx) {
        const tr = document.createElement('tr');
        const indexCol = document.createElement('td');
        indexCol.textContent = idx + 1;
        const statusRow = document.createElement('td');
        statusRow.textContent = record.status;
        const creatorRow = document.createElement('td');
        creatorRow.textContent = record.creator.displayName || response[i].creator.phoneNumber
        const companyRow = document.createElement('td')
        companyRow.textContent = record.attachment['Company Name'].value || '-';
        const productRow = document.createElement('td');
        if (record.attachment.Product) {
          productRow.textContent = record.attachment.Product.value || '-';
        }
        else {
          productRow.textContent = ''
        }
        const enquiryRow = document.createElement('td');
        enquiryRow.textContent = record.attachment.Enquiry.value || '-';
        tr.appendChild(indexCol);
        tr.appendChild(statusRow);
        tr.appendChild(creatorRow);
        tr.appendChild(companyRow);
        tr.appendChild(productRow);
        tr.appendChild(enquiryRow);
        body.appendChild(tr)
      });

      table.appendChild(body);
      spinner.remove();

      createModal(table);
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
