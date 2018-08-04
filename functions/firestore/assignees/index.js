/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */


'use strict';


const {
    db,
    rootCollections,
} = require('../../admin/admin');


module.exports = (change, context) => {
    const batch = db.batch();

    const newDocRef = change.after.exists ? change.after : null;

    const activityId = context.params.activityId;
    const phoneNumber = context.params.phoneNumber;

    const userProfile = rootCollections.profiles.doc(phoneNumber);

    /** A user has been unassigned from the activity.
     * Remove the activity doc from their profile.
     */
    if (!newDocRef) {
        batch.delete(userProfile
            .collection('Activities')
            .doc(activityId)
        );

        return batch.commit().catch(console.error);
    } else {
        /** A new user has been assigned to this activity.
         * Add the doc with the id, canEdit and timestamp
         * to their profile.
         */
        return userProfile
            .get()
            .then((doc) => {
                if (!doc.exists) {
                    batch.set(userProfile, { uid: null, });
                }

                batch.set(userProfile
                    .collection('Activities')
                    .doc(activityId), {
                        canEdit: newDocRef.get('canEdit'),
                        timestamp: newDocRef.createTime,
                    });

                return batch.commit();
            })
            .catch(console.error);
    }
};
