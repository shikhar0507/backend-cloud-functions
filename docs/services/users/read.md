# Reading User Profiles

endpoint: `/api/services/users/read`

method: `GET`

query parameter:

- `q`

- `as` (optional)

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

## View Custom Claims and User Metadata

> The `superUser` can also request the user's `metadata` and `customClaims`.

To create a request as a `superUser`, you can add the `as` query parameter along with the value `su` in the request URL.

example URL: `api/services/users/read?as=su&q=%2B919090909090&q=%2B918080808080`

The response body in such a case will look as follows:

```json
{
    "+919090909090": {
        "displayName": "metallica",
        "photoURL": "https://firebasestorage.googleapis.com/v0/b/growthfilev2-0.appspot.com/o/ARMXkaszqie4vK4w997M1hVYJiP2%2FprofilePicture?alt=media&token=771c58e2-8a55-4dce-9fed-862199818afd",
        "disabled": false,
        "metadata": {
            "lastSignInTime": "Sat, 09 Jun 2018 06:17:05 GMT",
            "creationTime": "Tue, 08 May 2018 17:09:31 GMT"
        },
        "customClaims": {
            "support": true,
            "templatesManager": false,
            "superUser": true
        }
    },
    "+918080808080": {
        "displayName": null,
        "photoURL": null,
        "disabled": null,
        "metadata": null,
        "customClaims": null
    }
}
```
