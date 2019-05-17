console.log('home loaded');
let office;

function searchOffice() {
  document.getElementById('continue').classList.add('invisible');
  const url = `${apiBaseUrl}/admin/search?support=true`
  const input = document.getElementById('office-search-field')
  const ul = document.querySelector('#office-search-form ul')
  ul.appendChild(getSpinnerElement().center())
  // if(!value) return label.textContent = 'No Office Name Entered'
  // label.textContent = '';
  // sendApiRequest(`${url}&office=${input.value}`, null, 'GET')
  //   .then(function (response) {
  //     return response.json();
  //   })
  //   .then(function (response) {
  //     // ul.querySelector('.spinner').remove();
  //     console.log('response', response);
  // if (!response.length) return label.textContent = 'No Offices Found'
  ul.innerHTML = '';
  var response = ['Puja Capital']
  response.forEach(function (name) {
    const li = document.createElement('li')
    li.textContent = name;
    li.onclick = function () {
      input.value = name;
      document.querySelector('.button-search').classList.add('invisible');

      document.getElementById('continue').classList.remove('invisible');
      [...ul.querySelectorAll('li')].forEach(function (el) {
        el.remove();
      })
    }
    ul.appendChild(li)
  })


  // })
  console.log('clicked')
}


function toggleSearchButton(e) {
  console.log(e);
  if (!e.value) {
    document.querySelector('.button-search').classList.add('invisible');
  } else {
    document.querySelector('.button-search').classList.remove('invisible');
  }
  document.getElementById("continue").classList.add('invisible');
}

function startAdmin(officeName) {
  office = officeName;
  document.getElementById('office-search-form').classList.add('hidden');
  document.querySelector('.action-icons-container').classList.remove('hidden');

}
const section = document.getElementById('action-section');



function createSearchForm(requestUrl, type) {
  const searchForm = document.createElement('form');
  const searchInput = document.createElement('input');
  const searchLink = document.createElement('a');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search an office';
  searchInput.classList.add('input-field');
  searchForm.style.display = 'inherit';
  searchLink.onclick = function () {

    sendApiRequest(`${requestUrl}&office=${searchInput.value}`, null, 'GET')
      .then(function (response) {
        return response.json();
      })
      .then(function (response) {

        console.log('response', response);
        const select = document.createElement('select');
        searchForm.style.display = 'none';
        if (!response.length) {
          const p = document.createElement('p');
          p.innerText = 'No Result found';
          section.appendChild(p);
          return;
        }
        const a = document.createElement('a');
        a.classList.add('button');
        a.href = '#';
        a.textContent = 'submit';
        a.onclick = function (event) {
          if (type === 'add-employees') {
            options.officeNames.push(select.options[select.selectedIndex].value);
            addEmployees(options);
          }
        }

        section.appendChild(select);
        section.appendChild(a);

        response.forEach((name) => {
          const option = document.createElement('option');
          option.value = name;
          option.innerHTML = name;
          select.appendChild(option);
        });

      })

  }
  searchLink.classList.add('button');
  searchLink.innerText = 'search';
  searchForm.appendChild(searchInput);
  searchForm.appendChild(searchLink);
  return searchForm;

}

function excelUploadContainer(claim) {
  const container = document.createElement('div')

  const templateNames = ["bill", "invoice", "material", "supplier-type", "recipient", "branch", "department", "leave-type", "subscription", "admin", "customer-type", "expense-type", "product", "employee"]
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
  const endDateLabel = document.createElement('label')
  endDateLabel.textContent = 'To';
  const endDateInput = document.createElement('input')
  endDateInput.type = 'date'
  endDateInput.value = moment().format('DD/MM/YYYY');
  endDateInput.id = 'end-time'
  const triggerButton = document.createElement('a')
  triggerButton.className = 'button mt-10'
  triggerButton.textContent = 'Trigger'
  triggerButton.id = 'trigger-report'
  let reportSelected;
  const selectBox = customSelect('Select Report')

  sendApiRequest(`http://localhost:5015/json?template=recipient&office=${office}`, null, 'GET').then(function (response) {
      return response.json();
    })
    .then(function (response) {

      const keys = Object.keys(response);
      if (!keys.length) return container.textContent = 'No Reports Found';
      keys.forEach(function (id) {
        const option = document.createElement('option')
        option.value = response[id].attachment.Name.value;
        option.textContent = response[id].attachment.Name.value;
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
  container.appendChild(recap)
  return container;
}


function triggerReportWithSupport() {

}

function triggerReportWithAdmin() {

}

function updatePhoneNumberWithSupport() {

}

function updatePhoneNumberWithAdmin() {

}

function employeExitWithSupport() {

}

function employeExitWithAdmin() {

}

function updateReportRecipientsWithSupport() {

}

function updateReportRecipientsWithAdmin() {

}

function updateSubscriptionWithAdmin() {

}

function updateSubscriptionWithSupport() {

}

function searchAndUpdateWithAdmin() {

}

function searchAndUpdateWithSupport() {

}

function viewEnquiries(options) {

}

/**
 * Only `support` and `manageTemplates` claim allow messing with the templates.
 */
function manageTemplates() {

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
  if (!jsonData.length) return;
  notificationLabel.warning('File is Empty')

  jsonData.forEach(function (val) {
    val.share = [];
  })

  getLocation().then(function (location) {

    const body = {
      office: office,
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
  }).catch(notificationLabel.warning)

}



function addNew(isSupport, isAdmin) {
  let templateSelected;
  const modal = createModal(excelUploadContainer({
    isSupport: isSupport,
    isAdmin: isAdmin
  }))

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
  })
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
    window.recaptchaVerifier = handleRecaptcha();
    window.recaptchaVerifier.render();
    window.recaptchaVerifier.verify().then(function(token){
      console.log(token)

    }).catch(console.log)

    // handleRecaptcha().then(function (verifier) {

    //   label.success('')
    //   sendApiRequest(`${apiBaseUrl}admin/trigger-report`, {
    //       office: office,
    //       report: selectedReport,
    //       startTime: startTime,
    //       endTime: endTime
    //     }, 'POST').then(function (response) {
    //       return response.json();
    //     })
    //     .then(function (response) {
    //       console.log(response);
    //       label.success(`${selectedReport} successfully triggered`)

    //     }).catch(function (error) {
    //       label.warning('Please Try again Later')
    //     })
    // }).catch(console.log)

    // if (window.recaptchaVerifier) {
    //   window.recaptchaVerifier.clear();
    // }
    // window.recaptchaVerifier.render();
  }


  document.getElementById('modal-box').appendChild(modal);
}

function sendReport() {

}

function triggerReport(options) {

}

function changePhoneNumber(options) {

}

function employeeResign(options) {

}

function updateRecipient(options) {

}

function updateSubscription(options) {

}

function updateActivity(options) {

}

function viewEnquiries() {

  const table = document.createElement('table');
  table.id = 'enquiry-table'
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

  sendApiRequest('http://localhost:5015/json?template=enquiry', null, 'GET')
    .then(function (response) {
      return response.json();
    })
    .then(function (response) {
      const body = document.createElement('tbody')
      console.log(response);
      Object.keys(response).forEach(function (id, idx) {
        const tr = document.createElement('tr');
        const indexCol = document.createElement('td');
        indexCol.textContent = idx + 1;
        const statusRow = document.createElement('td');
        statusRow.textContent = response[id].status;
        const creatorRow = document.createElement('td');
        creatorRow.textContent = response[id].creator.displayName || response[i].creator.phoneNumber
        const companyRow = document.createElement('td')
        companyRow.textContent = response[id].attachment['Company Name'].value || '-';
        const productRow = document.createElement('td');
        productRow.textContent = response[id].attachment.Product.value || '-';
        const enquiryRow = document.createElement('td');
        enquiryRow.textContent = response[id].attachment.Enquiry.value || '-';
        tr.appendChild(indexCol);
        tr.appendChild(statusRow);
        tr.appendChild(creatorRow);
        tr.appendChild(companyRow);
        tr.appendChild(productRow);
        tr.appendChild(enquiryRow);
        body.appendChild(tr)

      })
      table.appendChild(body)

      document.getElementById('modal-box').appendChild(createModal(table));

    })
}

function manageTemplates(options) {

};

function handleActionIconClick(event) {
  event.preventDefault();
  // Delete all elements for a clean slate
  while (section.firstChild) {
    section.removeChild(section.firstChild);
  }

  console.log('clicked', event.target.id);

  return firebase
    .auth()
    .currentUser
    .getIdTokenResult()
    .then(function (getIdTokenResult) {
      const claims = getIdTokenResult.claims;
      console.log(claims)
      options.isSupport = claims.support;
      if (Array.isArray(claims.admin)) {
        if (claims.admin.length > 0) {
          options.isAdmin = true
          options.officeNames = claims.admin
        }
      }
      options.isTemplateManager = claims.templateManager;

      if (event.target.id === 'add-employees') {
        if (options.isSupport) return section.appendChild(createSearchForm(`${apiBaseUrl}/admin/search?support=true`, event.target.id))
        addEmployees(options);
      }

      if (event.target.id === 'trigger-reports') {

        if (options.isAdmin) {
          return void triggerReportWithAdmin(options);
        }

        return void triggerReportWithSupport();
      }

      if (event.target.id === 'change-phone-number') {
        if (options.isAdmin) {
          return void updatePhoneNumberWithAdmin(options);
        }

        return updatePhoneNumberWithSupport(options);
      }

      if (event.target.id === 'employee-resign') {
        if (options.isAdmin) {
          return employeExitWithAdmin(options);
        }

        return employeExitWithSupport(options);
      }

      if (event.target.id === 'update-subscription') {
        if (options.isAdmin) {
          return updateSubscriptionWithAdmin(options);
        }

        return updateSubscriptionWithSupport(option);
      }

      if (event.target.id === 'update-activity') {
        if (options.isAdmin) {
          return updateSubscriptionWithSupport(options);
        }

        return updateSubscriptionWithSupport(options);
      }

      if (event.target.id === 'view-enquiries') {
        return viewEnquiries(options);
      }

      if (event.target.id === 'manage-templates') {
        return void manageTemplates(options);
      }
    })
    .catch(console.error);
};