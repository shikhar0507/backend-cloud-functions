console.log('home loaded');

const section = document.getElementById('action-section');

function getTableHeadWithValue(value) {
  const th = document.createElement('th');
  th.innertText = value;

  return th;
}

function generateBulkCreationResultTable(responseObject = []) {
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  const firstRow = document.createElement('tr');

  firstRow.appendChild(getTableHeadWithValue('Name'));
  firstRow.appendChild(getTableHeadWithValue('Employee Contact'));
  firstRow.appendChild(getTableHeadWithValue('Employee Code'));
  firstRow.appendChild(getTableHeadWithValue('Designation'));
  firstRow.appendChild(getTableHeadWithValue('Department'));
  firstRow.appendChild(getTableHeadWithValue('Base Location'));
  firstRow.appendChild(getTableHeadWithValue('First Supervisor'));
  firstRow.appendChild(getTableHeadWithValue('Second Supervisor'));
  firstRow.appendChild(getTableHeadWithValue('Third Supervisor'));
  firstRow.appendChild(getTableHeadWithValue('Daily Start Time'));
  firstRow.appendChild(getTableHeadWithValue('Weekly Off'));
  firstRow.appendChild(getTableHeadWithValue('Result'));

  firstRow.appendChild(resultColumn);
  tbody.appendChild(firstRow);

  responseObject.forEach((result) => {
    const secondaryRow = document.createElement('tr');
    const name = result.Name;
    const employeeContact = result['Employee Contact'];
    const employeeCode = result['Employee Code'];
    const designation = result.Designation;
    const department = result['Department'];
    const baseLocation = result['Base Location'];
    const firstSupervisor = result['First Supervisor'];
    const secondSupervisor = result['Second Supervisor'];
    const thirdSupervisor = result['Third Supervisor'];
    const dailyStartTime = result['Daily Start Time'];
    const dailyEndTime = result['Daily End Time'];
    const weeklyOff = result['Weekly Off'];
    const rejected = result.rejected;

    secondaryRow.appendChild((getTableHeadWithValue(name)));
    secondaryRow.appendChild(getTableHeadWithValue(employeeContact));
    secondaryRow.appendChild(getTableHeadWithValue(employeeCode));
    secondaryRow.appendChild(getTableHeadWithValue(designation));
    secondaryRow.appendChild(getTableHeadWithValue(department));
    secondaryRow.appendChild(getTableHeadWithValue(baseLocation));
    secondaryRow.appendChild(getTableHeadWithValue(firstSupervisor));
    secondaryRow.appendChild(getTableHeadWithValue(secondSupervisor));
    secondaryRow.appendChild(getTableHeadWithValue(thirdSupervisor));
    secondaryRow.appendChild(getTableHeadWithValue(dailyStartTime));
    secondaryRow.appendChild(getTableHeadWithValue(dailyEndTime));
    secondaryRow.appendChild(getTableHeadWithValue(weeklyOff));
    secondaryRow.appendChild(getTableHeadWithValue(result));

    tbody.appendChild(secondaryRow);
  });

  console.log('tbody', tbody);

  table.appendChild(tbody);

  return table;
}

function createEmployeesAsSupport(event) {
  /**
   * Create a file upload button
   */

  const div = document.createElement('div');
  div.id = 'file-upload-wrapper';
  // <button class="button">Select a file</button>
  // <input type="file"></input>
  const button = document.createElement('button');
  button.classList.add('button');
  button.innerText = 'Submit';
  const input = document.createElement('input');
  input.type = 'file';

  div.appendChild(button);
  div.appendChild(input)

  section.appendChild(div);


};

function addEmployeeWithSupport(options) {
  const requestUrl = `${apiBaseUrl}/admin/search?support=true`;
  const searchForm = document.createElement('form');
  const searchInput = document.createElement('input');
  const searchLink = document.createElement('a');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search an office';
  searchInput.classList.add('input-field');
  searchForm.style.display = 'inherit';
  
  searchLink.classList.add('button');
  searchLink.innerText = 'search';
  searchForm.appendChild(searchInput);
  searchForm.appendChild(searchLink);
  section.appendChild(searchForm);

  searchLink.onclick = function () {
    console.log('button clicked');

    /** Hide all previously warning labels */
    document
      .querySelectorAll('.warning-label')
      .forEach(function (elem) { elem.style.display = 'none' });

    const searchedTerm = searchInput.value;

    if (!isNonEmptyString(searchedTerm)) {
      const node = document.createElement('p');
      node.classList.add('warning-label');
      node.innerText = 'Invalid input';

      return void insertAfterNode(searchForm, node);
    }

    console.log('searched for:', searchedTerm);
    console.log('url', `${requestUrl}&office=${searchedTerm}`);

    return sendApiRequest(`${requestUrl}&office=${searchedTerm}`, null, 'GET')
      .then(function (response) { return response.json(); })
      .then(function (response) {
        console.log('response', response);

        const select = document.createElement('select');
        searchForm.style.display = 'none';

        response.forEach((name) => {
          const option = document.createElement('option');
          option.value = name;
          option.innerHTML = name;

          select.appendChild(option);
        });

        if (response.length > 0) {
          const a = document.createElement('a');
          a.classList.add('button');
          a.href = '#';
          a.textContent = 'submit';

          a.onclick = function (event) {
            a.textContent = 'clear';

            createEmployeesAsSupport(event);
          }

          section.appendChild(select);
          section.appendChild(a);

        } else {
          const p = document.createElement('p');
          p.innerText = 'No offices found';
          section.appendChild(p);
        }

      })
      .catch(console.error);
  }
}

function addEmployeeWithAdmin() {

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

function viewEnquiries() {

}

/**
 * Only `support` and `manageTemplates` claim allow messing with the templates.
 */
function manageTemplates() {

}

function addEmployees(options) {

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

}

function manageTemplates(options) {

};

function handleActionIconClick(event) {
  // Delete all elements for a clean slate
  while (section.firstChild) {
    section.removeChild(section.firstChild);
  }

  console.log('clicked', event.target.id);

  const options = {
    isSupport: false,
    isAdmin: false,
    isTemplateManager: false,
    officeNames: [],
  };

  return firebase
    .auth()
    .currentUser
    .getIdTokenResult()
    .then(function (getIdTokenResult) {
      const claims = getIdTokenResult.claims;

      if (event.target.id === 'add-employees') {
        if (options.isAdmin) {
          return void addEmployeeWithAdmin(options);
        }

        return void addEmployeeWithSupport(options);
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
