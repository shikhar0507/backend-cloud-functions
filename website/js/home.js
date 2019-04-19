console.log('home loaded');
const section = document.getElementById('action-section');

function addEmployees() {
  const fileUploadWrapper = document.createElement('div');
  const uploadButton = document.createElement('button');
  const input = document.createElement('input');

  uploadButton.classList.add('button');
  uploadButton.innerText = 'Select a file';
  fileUploadWrapper.id = 'file-upload-wrapper';
  input.setAttribute('type', 'file');

  fileUploadWrapper.appendChild(uploadButton);
  fileUploadWrapper.appendChild(input);
  section.style.alignItems = 'center';
  section.appendChild(fileUploadWrapper);
}

function triggerReport() {

}

function changePhoneNumber() {

}

function employeeResign() {

}

function updateRecipient() {

}

function updateSubscription() {

}

function updateActivity() {

}

function handleActionIconClick(event) {
  // document.getElementById('default-text').style.display = 'none';
  section.innerHTML = '';

  if (event.target.id === 'add-employees') {
    return void addEmployees();
  }

  if (event.target.id === 'trigger-reports') {
    return void triggerReport();
  }

  if (event.target.id === 'change-phone-number') {
    return void changePhoneNumber();
  }

  if (event.target.id === 'employee-resign') {
    return void employeeResign();
  }

  if (event.target.id === 'update-subscription') {
    return void updateSubscription();
  }

  if (event.target.id === 'update-activity') {
    return void updateActivity();
  }
};
