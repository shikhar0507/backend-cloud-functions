function sendRequest(requestBody) {
  const requestBody = {

  };

  const requestUrl = 'https://api2.growthfile.com/api/activities/create';

  const init = {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  };

  return firebase
    .auth
    .currentUser()
    .getIdToken()
    .then((idToken) => {
      init.headers['Authorization'] = `Bearer ${idToken}`;

      return fetch(requestUrl, init);
    })
    .then((response) => response.json())
    .then((data) => {
      console.log('data', data);

      // hide form
      // show text that office has been created successfully.
    })
    .catch(console.error);
}

document
  .getElementById('#submit-form')
  .onclick = function () {
    // const result = validateForm(data);

    // if (!result.success) {
    //   return showToast(result.message);
    // }

    // if (!firebase.auth().currentUser) {
    //   // show login box

    //   return;
    // }

    // return sendRequest(requestBody);
  };
