/* eslint-disable */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import * as functions from "firebase-functions";

const winetopia2025_event_id = "39d1bce3-ad5b-41fb-8a41-aadee4d239b9";

admin.initializeApp();

const createNewUserRecord = async (uid: string, email: string, first_name: string, last_name: string, phone: string, ticket_type: string, ticket_number: string) => {
    let silver_token: number;
    let gold_token: number;

    if(ticket_type.toLowerCase() == "premium"){
        silver_token = 10;
        gold_token = 1;
    }

    else if(ticket_type.toLowerCase() == "standard"){
        silver_token = 5;
        gold_token = 0;
    }

    else{
        silver_token = 0;
        gold_token = 0;
    }

    try {
        await admin.firestore().collection('users').doc(uid).set({
            email: email,
            first_name: first_name,
            last_name: last_name,
            phone: phone,
            ticket_type: ticket_type,
            ticket_number: ticket_number,
            silver_token: silver_token,
            gold_token: gold_token,
        });
        logger.info("✅ User record created in Firestore for UID:", uid);
    } catch (error: any) {
        logger.error("Error creating user record in Firestore:", error);
    }
}

const createNewUserAuth = async (password: string, email: string, first_name: string, last_name: string, phone: string, ticket_type: string, ticket_number: string) => {
    try{
        const authRecord = await admin.auth().createUser({
            uid: ticket_number,
            email: email,
            password: "Winetopia2025", // change this to variable in the furture.
        });
        logger.info("✅ User created:", authRecord.email);
        await createNewUserRecord(authRecord.uid, email, first_name, last_name, phone, ticket_type, ticket_number);
        return authRecord.uid;;
    }catch (error: any){
        if(error.code === "auth/email-already-exists"){
            logger.warn("⚠️ User already exists with email:", email);
        }
        else{
            logger.error("Error creating user: ", error);
        }
        //call send email function, pass in the error
        return null;
    }
}

const overrideCurrentUser = async (email: string, first_name: string, last_name: string, phone: string, ticket_number: string) => {
    try{
        const authRecord = await admin.auth().getUser(ticket_number);
        if(email != authRecord.email){
            await admin.auth().updateUser(ticket_number, {
                email: email,
            });
        }

        await admin.firestore().collection('users').doc(ticket_number).update({
            email: email,
            first_name: first_name,
            last_name: last_name,
            phone: phone,
        });
        
    }catch (error: any){
        if(error.code === "auth/email-already-exists"){
            logger.warn("⚠️ Other user already exists with email:", email);
        }
        else{
            logger.error("Error override user: ", error);
        }
        //call send email function, pass in the error
    }
}

const checkExistingTicket = async (ticket_number: string) => {
    try {
        await admin.auth().getUser(ticket_number);
        logger.info("The ticket exist and will be override with the new payload");
        return true;
    } catch (error: any) {
        if(error.code === "auth/user-not-found"){
            console.log("User not found, this could be a new ticket");
            return false;
        }
        else{
            console.log("Error: ", error);
            return null;
        }
    }
}

function checkEventId(event_id: string): boolean {
    return event_id === winetopia2025_event_id;
}

export const flicketWebhookHandler = functions.https.onRequest(
    {
        region: "australia-southeast1",
    },
    async (req, res) => {
        logger.info("Webhook Received!");
        try {
            const body = req.body;
            logger.info("Webhook Payload (JSON):", body);
        } catch (error) {
            logger.warn("Could not parse request body as JSON. Logging as text.");
            logger.info("Webhook Payload (Text):", req.body); // Fallback to text
        }
        
        const event_id = req.body?.event_id ?? null;
        const event_name = req.body?.even_name ?? "Event2025";
        const ticket_holder_details = req.body?.ticket_holder_details ?? null;
        const ticket_holder_email = ticket_holder_details?.email ?? null;
        const ticket_type = req.body?.ticket_type ?? null;
        const ticket_number = req.body?.barcode ?? null;

        if(!checkEventId(event_id) ){
            logger.info("This webhook is not for Winetopia event");
        }

        else if(ticket_holder_details == null){
            logger.info("ticket_holder_details is null or not found!");
        }

        else if(ticket_holder_email == null){
            logger.info("ticket_holder_details.email is null or not found!");
        }

        else if(ticket_type == null){
            logger.info("ticket_type is null!");
        }

        else if(ticket_number == null){
            logger.info("ticket_number is null!")
        }

        else{
            const userExistFlag = await checkExistingTicket(ticket_number);
            if(userExistFlag === true){
                await overrideCurrentUser(ticket_holder_email, ticket_holder_details.first_name, ticket_holder_details.last_name, ticket_holder_details.cell_phone, ticket_number);
            }
            else if(userExistFlag === false){
                await createNewUserAuth(event_name, ticket_holder_email, ticket_holder_details.first_name, ticket_holder_details.last_name, ticket_holder_details.cell_phone, ticket_type, ticket_number);
            }
        }

        res.status(200).end();
    }
);
