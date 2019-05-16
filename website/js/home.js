console.log('home loaded');
function searchOffice(){
  document.getElementById('continue').classList.add('invisible');
  const url = `${apiBaseUrl}/admin/search?support=true`
  const input = document.getElementById('office-search-field')
  const ul = document.querySelector('#office-search-form ul')
  ul.appendChild(getSpinnerElement().center())
  // if(!value) return label.textContent = 'No Office Name Entered'
  // label.textContent = '';
  sendApiRequest(`${url}&office=${input.value}`, null, 'GET')
      .then(function (response) {
        return response.json();
      })
      .then(function (response) {
        // ul.querySelector('.spinner').remove();
        console.log('response', response);
        // if (!response.length) return label.textContent = 'No Offices Found'
        ul.innerHTML = '';
        response.forEach(function(name){
          const li = document.createElement('li')
          li.textContent = name;
          li.onclick = function(){
            input.value = name;
            document.querySelector('.button-search').classList.add('invisible');
            
            document.getElementById('continue').classList.remove('invisible');
            [...ul.querySelectorAll('li')].forEach(function(el){
               el.remove();
            })
          }
          ul.appendChild(li)
        })
    

      })
  console.log('clicked')
}


function toggleSearchButton(e){
  console.log(e);
  if(!e.value) {
    document.querySelector('.button-search').classList.add('invisible');
  }
  else {
    document.querySelector('.button-search').classList.remove('invisible');
  }
  document.getElementById("continue").classList.add('invisible');
}

function startAdmin(office){
  document.getElementById('office-search-form').classList.add('hidden');
  document.querySelector('.action-icons-container').classList.remove('hidden')
}
const section = document.getElementById('action-section');

const options = {
  isSupport: false,
  isAdmin: false,
  isTemplateManager: false,
  officeNames: [],
};


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

function excelUploadContainer(id) {
  const container = document.createElement('div')

  const uploadContainer = document.createElement('div')
  uploadContainer.className = 'upload-container'
  const input = document.createElement('input')
  input.type = 'file';
  input.id = id;
  input.accept = '.xlsx, .xls , .csv'
  const label = document.createElement('label')
  label.textContent = 'Upload File';
  uploadContainer.appendChild(label);
  uploadContainer.appendChild(input);
  const p = document.createElement('p')
  p.className = 'notification-label';
  uploadContainer.appendChild(p);
  const result = document.createElement('div')
  result.id = 'upload-result-error';
  uploadContainer.appendChild(result)

  const downloadContainer = document.createElement('div');
  downloadContainer.className = 'download-container mt-30';
  const button = document.createElement('button')
  button.className = 'button'
  button.textContent = 'Download Sample';
  downloadContainer.appendChild(button)
  container.appendChild(uploadContainer);
  container.appendChild(downloadContainer);

  return container;

}

function BulkCreateErrorContainer(originalData, rejectedOnes) {
  const cont = document.getElementById('upload-result-error')
  cont.innerHTML = '';
  const frag = document.createDocumentFragment();
  if (rejectedOnes.length >= 2) {
    cont.style.height = '200px';
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

function addEmployees(options) {
  /**
   * Create a file upload button
   */

  const url = apiBaseUrl + '/admin/bulk?support=true'

  const modal = createModal(excelUploadContainer('upload-employee'))
  const upload = modal.querySelector('#upload-employee')
  const notificationLabel = modal.querySelector('.notification-label')
  upload.addEventListener('change', function (evt) {
    evt.stopPropagation();
    evt.preventDefault();

    const files = evt.target.files;
    const file = files[0];
    const reader = new FileReader();

    reader.onload = function (e) {
      const data = e.target.result;

      e.target.ressul
      const wb = XLSX.read(data, {
        type: 'binary'
      });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(ws, {
        blankRows: false,
        defval: '',
        raw: false
      });
      if (!jsonData.length) {
        notificationLabel.className = 'notification-label warning-label'
        notificationLabel.textContent = 'File is Empty'
        return;
      };
      jsonData.forEach(function (val) {
        val.share = [];
      })

      getLocation().then(function (location) {

        const body = {
          office: options.officeNames[0],
          template: 'employee',
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
            if (!rejectedOnes.length) {
              notificationLabel.className = 'notification-label success-label'
              notificationLabel.textContent = 'Success';
              return;
            }
            notificationLabel.textContent = '';
            BulkCreateErrorContainer(jsonData, rejectedOnes)
          }).catch(console.error);
      }).catch(function (error) {
        notificationLabel.className = 'notification-label warning-label'
        notificationLabel.textContent = error.message;
      })

    }
    reader.readAsBinaryString(file);
    console.log(evt);
  });
  document.getElementById('modal-box').appendChild(modal);
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

function viewEnquiries(options) {

  const table = document.createElement('table');
  table.id = 'enquiry-table'
  const head = document.createElement('thead');
  const headTr = document.createElement('tr');
  const headerNames = ['S.No','Status','Creator','Company','Product','Enquiry'];
  headerNames.forEach(function(name){
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
            Object.keys(response).forEach(function(id,idx){
              const tr = document.createElement('tr');
              const indexCol = document.createElement('td');
              indexCol.textContent = idx +1;
              const statusRow = document.createElement('td');
              statusRow.textContent = response[id].status;
              const creatorRow = document.createElement('td');
              creatorRow.textContent = response[id].creator.displayName || response[i].creator.phoneNumber
              const companyRow = document.createElement('td')
              companyRow.textContent = response[id].companyName || '-';
              const productRow = document.createElement('td');
              productRow.textContent = response[id].product || '-';
              const enquiryRow = document.createElement('td');
              enquiryRow.textContent = response[id].enquiry || '-';
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