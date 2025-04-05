import { ShowToastEvent } from 'lightning/platformShowToastEvent';
export { popToast };

const popToast = (callingObject, variant, messageData, callingComponentName) => {
    /*
        Usage:
            Include this line in the LWC calling this function:
                import { popToast } from 'c/utilities';

            Example use (error example, but can be used for other variants without the catch):
                .catch(error => {popToast(this, 'error', error, 'Approval Button Manager');})


        callingObject is 'this' when the function is called.
        Include callingComponentName to log a comment with message data any time it's called (useful for investigating errors).
    */

    if (callingComponentName) {console.log(callingComponentName + ' - Pop Toast Message: ', messageData);}

    let output;
    if      (typeof messageData              === 'string') {output = messageData;}
    else if (typeof messageData.message      === 'string') {output = messageData.message;}
    else if (typeof messageData.body.message === 'string') {output = messageData.body.message;}
    else                                                   {output = "Unknown error, couldn't find error message";}

    callingObject.dispatchEvent(
        new ShowToastEvent({
            title: variant.toUpperCase(),
            message: output,
            variant: variant
        })
    );
};