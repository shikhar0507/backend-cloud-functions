const submitButton = document.getElementById('submit-button');


submitButton.onclick = function () {
  if (!firebase.auth().currentUser) {
    window.location.href = `/auth?redirect_to=${window.location.href}`;

    return;
  }


  return sendApiRequest('', requestBody, 'POST')
    .then(function (response) {
      if (!response.ok) {
        setMessage('Something went wrong. Please try again later...');

        return;
      }
    })
    .catch(console.error);
}
