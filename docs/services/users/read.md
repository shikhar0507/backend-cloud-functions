# Reading User Profiles

endpoint: `/api/services/users/read`

method: `GET`

query parameter: `q`

The `.../read` endpoint accepts an argument `q` which can either be an array or a single value containing the phone numbers of all the users you want to get the profiles of.

Note: The `+` character is represented by `%2B` in url encoded characters. Check out [W3Schools URL Encoding](https://www.w3schools.com/tags/ref_urlencode.asp) for more details.

example: single phone number `.../api/services/users/read?q=%2B919090909090`

## Response For A Single Phone Number

```json
{
    "+919090909090": {
        "photoURL": "https://firebasestorage.googleapis.com/v0/b/growthfilev2-0.appspot.com/o/ARMXkaszqie4vK4w997M1hVYJiP2%2FprofilePicture?alt=media&token=771c58e2-8a55-4dce-9fed-862199818afd",
        "displayName": "metallica",
        "lastSignInTime": null
    }
}
```

example: multiple phone numbers: `.../api/services/users/read?q=%2B919090909090&q=%2B918080808080`

## Response For Multiple Phone Numbers

```json
{
    "+919090909090": {
        "photoURL": "https://firebasestorage.googleapis.com/v0/b/growthfilev2-0.appspot.com/o/ARMXkaszqie4vK4w997M1hVYJiP2%2FprofilePicture?alt=media&token=771c58e2-8a55-4dce-9fed-862199818afd",
        "displayName": "metallica",
        "lastSignInTime": null
    },
    "+918080808080": {
        "photoURL": null,
        "displayName": null,
        "lastSignInTime": null
    }
}
```
