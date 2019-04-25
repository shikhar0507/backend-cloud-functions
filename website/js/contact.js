const submitButton = document.getElementById('submit-button');

function setMessage(messageString) {
  const messageNode = document.getElementById('message');

  messageNode.innerText = messageString;

  /** Make the element visible if hidden */
  if (messageNode.classList.contains('hidden')) {
    messageNode.classList.remove('hidden');
  }
}

submitButton.onclick = function () {
  if (!firebase.auth().currentUser) {
    window.location.href = `/auth?redirect_to=${window.location.href}`;

    return;
  }

  const spinner = getSpinnerElement();

  return sendApiRequest('', requestBody, 'POST')
    .then(function (response) {
      if (!response.ok) {
        setMessage('Something went wrong. Please try again later...');

        return;
      }


    })
    .catch(console.error);
}
