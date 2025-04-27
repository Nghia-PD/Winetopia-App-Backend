/* eslint-disable */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import * as functions from "firebase-functions";

const winetopia2025_event_id = "39d1bce3-ad5b-41fb-8a41-aadee4d239b9";
const ticket_collection = "2025_tickets";

admin.initializeApp();

const createNewTicketRecord = async (ticket_number: string, ticket_type: string, ticket_holder_email: string) => {
    try {
        await admin.firestore().collection(ticket_collection).doc(ticket_number).set({
            ticket_number: ticket_number,
            ticket_holder_email: ticket_holder_email,
            ticket_type: ticket_type,
        });
        logger.info("✅ Create a new ticket record in Firestore with ticket id: ", ticket_number);
    } catch (error) {
        logger.error("Error create a new ticket in Firestore: ", error);
    }
}

const upgradeTicket = async (ticket_number: string, current_ticket_type: string, new_ticket_type: string, silver_token: string, gold_token: string) => {
    try {
        // Upgrading ticket type - Flicket support upgrading ticket only!
        if(current_ticket_type.toLowerCase() == "standard" && new_ticket_type.toLocaleLowerCase() == "premium"){
            await admin.firestore().collection("Users").doc().update({
                silver_token: parseInt(silver_token) + 5,
                gold_token: parseInt(gold_token) + 1
            })
            await admin.firestore().collection(ticket_collection).doc(ticket_number).update({
                ticket_type: new_ticket_type // Update ticket type
            });
        }
    } catch (error) {
        logger.error("Error when upgrade ticket type, ticket number: ", ticket_number);
    }
}

const changeEmailOnTicket = async (ticket_number: string, json_attendee_email: string, current_email_on_ticket: string, silver_token: string, gold_token: string) => {
    try {
        // TODO: deload
        await admin.firestore().collection("Users").doc(current_email_on_ticket).update({
            silver_token: parseInt(silver_token) - 5,
            gold_token: parseInt(gold_token) - 1,
        });

        // Update the ticket info.
        await admin.firestore().collection(ticket_collection).doc(ticket_number).update({
            ticket_holder_email: json_attendee_email,
        });
    } catch (error) {
        logger.info("Error when changging email on ticket: ", error);
    }
}

const changeOtherDetailsOnTicket = async (ticket_number: string, email_on_ticket: string, json_first_name: string, json_last_name: string, json_phone: string) => {
    try {
        await admin.firestore().collection("Users").doc(email_on_ticket).update({
            first_name: json_first_name,
            last_name: json_last_name,
            phone: json_phone
        });
    } catch (error) {
        logger.info("Error when override user: ", email_on_ticket);
    }
}

const changeOnTicketHandler = async (target_ticket_data: any, ticket_number: string, json_attendee_email: string, json_ticket_type: string, json_attendee_first_name: string, json_attendee_last_name: string, json_attendee_phone: string) => {
    try {
        const current_email_on_ticket = target_ticket_data.email;
        const ticket_number = target_ticket_data.ticket_number;
        const current_ticket_type = target_ticket_data.ticket_type;
        
        const current_attendee = await admin.firestore().collection("Users").doc(current_email_on_ticket).get();
        const silver_token = await current_attendee.get("silver_token");
        const gold_token = await current_attendee.get("gold_token");
        
        // Changing email on ticket
        if(current_email_on_ticket != json_attendee_email){
            changeEmailOnTicket(ticket_number, json_attendee_email, current_email_on_ticket, silver_token, gold_token);
            createNewUserAuth(json_attendee_email);
            createNewUserRecord(json_attendee_email, json_attendee_first_name, json_attendee_last_name, json_attendee_phone, json_ticket_type, ticket_number);
        }
        
        // Upgrade ticket type
        else if(current_ticket_type != json_attendee_email){
            upgradeTicket(ticket_number, current_ticket_type, json_ticket_type, silver_token, gold_token);
        }

        // Changing other details than email
        else{
            changeOtherDetailsOnTicket(ticket_number, current_email_on_ticket, json_attendee_first_name, json_attendee_last_name, json_attendee_phone);
        }
    }catch (error) {
        logger.error("Error edit ticket " + ticket_number + " : " + error);
    }
}

const createNewUserRecord = async (email: string, first_name: string, last_name: string, phone: string, ticket_type: string, ticket_number: string) => {
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
        await admin.firestore().collection('users').doc(email).set({
            email: email,
            first_name: first_name,
            last_name: last_name,
            phone: phone,
            ticket_type: ticket_type,
            ticket_number: ticket_number,
            silver_token: silver_token,
            gold_token: gold_token,
        });
        logger.info("✅ User record created in Firestore for UID:", email);
    } catch (error) {
        logger.error("Error creating user record in Firestore: ", error);
    }
}

const createNewUserAuth = async (email: string) => {
    try{
        const authRecord = await admin.auth().createUser({
            uid: email,
            email: email,
            password: "Winetopia2025", // change this to variable in the furture.
        });
        logger.info("✅ User created:", authRecord.email);
        return authRecord.uid;;
    }catch (error: any){
        if(error.code === "auth/email-already-exists"){
            //TODO send email here
            logger.warn("⚠️ User already exists with email:", email);
        }
        else{
            logger.error("Error creating user: ", error);
        }
        //call send email function, pass in the error
        return null;
    }
}

const checkExistingTicket = async (ticket_number: string) => {
    try {
        const target_ticket = await admin.firestore().collection(ticket_collection).doc(ticket_number).get();
        if(target_ticket.exists){
            logger.info("Found an exist ticket number: ", ticket_number);
        }
        else{
            logger.info("New ticket number: ", ticket_number);
        }

        return target_ticket.data;
    } catch (error) {
        logger.info("Error when trying to access the ticket: ", error);
        return null;
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
        
        const json_event_id = req.body?.event_id ?? null;
        const json_ticket_type = req.body?.ticket_type ?? null;
        const json_ticket_number = req.body?.barcode ?? null;

        const json_ticket_holder_details = req.body?.ticket_holder_details ?? null;
        const json_ticket_holder_email = json_ticket_holder_details?.email ?? null;
        const json_ticket_holder_first_name = json_ticket_holder_details?.first_name ?? null;
        const json_ticket_holder_last_name = json_ticket_holder_details?.last_name ?? null;
        const json_ticket_holder_phone = json_ticket_holder_details?.phone ?? null;

        if(!checkEventId(json_event_id) ){
            logger.info("This webhook is not for Winetopia event");
        }

        else if(json_ticket_holder_details == null){
            logger.info("ticket_holder_details is null or not found!");
        }

        else if(json_ticket_holder_email == null){
            logger.info("ticket_holder_details.email is null or not found!");
        }

        else if(json_ticket_type == null){
            logger.info("ticket_type is null!");
        }

        else if(json_ticket_number == null){
            logger.info("ticket_number is null!")
        }

        else{
            const target_ticket = checkExistingTicket(json_ticket_number);

            if(target_ticket == null){
                logger.info("Their might be an error when checking ticket: ", json_ticket_number);
            }

            // New ticket
            else if(target_ticket == undefined){
                logger.info("NOT found ticket number: " + json_ticket_number + "in the database!");
                createNewTicketRecord(json_ticket_number, json_ticket_type, json_ticket_holder_email);
                const authRecord = createNewUserAuth(json_ticket_holder_email);
                if(authRecord == null){
                    // TODO: call the send fail email function here.
                    logger.info("Error when create new Auth. Double check to see if this email have been used!");
                }
                else{
                    // TODO: call the success email function here.
                    createNewUserRecord(json_ticket_holder_email, json_ticket_holder_first_name, json_ticket_holder_last_name, json_ticket_holder_phone, json_ticket_type, json_ticket_number);
                }
            }
            else{
                logger.info("Found ticket number: " + json_ticket_number + " in the database!");
                changeOnTicketHandler(target_ticket, json_ticket_number, json_ticket_holder_email, json_ticket_type, json_ticket_holder_first_name, json_ticket_holder_last_name, json_ticket_holder_phone);
            }
        }

        res.status(200).end();
    }
);
