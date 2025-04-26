/* eslint-disable */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import * as functions from "firebase-functions";
import { DocumentSnapshot } from "firebase-admin/firestore";

const winetopia2025_event_id = "39d1bce3-ad5b-41fb-8a41-aadee4d239b9";
const ticket_collection = "2025_tickets";

admin.initializeApp();

const createNewTicketRecord = async (ticket_number: string, ticket_type: string, ticket_holder_email: string, order_number: string) => {
    try {
        await admin.firestore().collection(ticket_collection).doc(ticket_number).set({
            ticket_number: ticket_number,
            ticket_holder_email: ticket_holder_email,
            ticket_type: ticket_type,
            order_number: order_number,
        });
        logger.info("✅ Create a new ticket record in Firestore with ticket id: ", ticket_number);
    } catch (error) {
        logger.error("Error create a new ticket in Firestore: ", error);
    }
}


// TODO split upgrading ticket type and change email on ticket into 2 functions.
const editTicketDetails = async (target_ticket: DocumentSnapshot, ticket_number: string, ticket_type: string, email: string, order_number: string) => {
    try {
        const current_email_on_ticket = await target_ticket.get("ticket_holder_email");
        const current_ticket_type = await target_ticket.get("ticket_type");
        const current_attendee = await admin.firestore().collection("Users").doc(current_email_on_ticket).get();
        const silver_token = await current_attendee.get("silver_token");
        const gold_token = await current_attendee.get("gold_token");
        
        // Changing email on ticket
        if(current_email_on_ticket != email){
            // TODO: deload
            await admin.firestore().collection("Users").doc(current_email_on_ticket).update({
                silver_token: parseInt(silver_token) - 5,
                gold_token: parseInt(gold_token) - 1,
            });

            // TODO: create new auth

            // TODO: create new user record

            // Update the ticket info.
            await admin.firestore().collection(ticket_collection).doc(ticket_number).update({
                ticket_holder_email: email,
                order_number: order_number 
            });
        }
            
        // Upgrading ticket type - Flicket support upgrading ticket only!
        if(current_ticket_type.toLowerCase() == "standard" && ticket_type.toLocaleLowerCase() == "premium"){
            
            await admin.firestore().collection("Users").doc(email).update({
                silver_token: parseInt(silver_token) + 5,
                gold_token: parseInt(gold_token) + 1
            })
            await admin.firestore().collection(ticket_collection).doc(ticket_number).update({
                ticket_type: ticket_type // Update ticket type
            });
        }
    }
    catch (error) {
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

const createNewUserAuth = async (email: string, first_name: string, last_name: string, phone: string, ticket_type: string, ticket_number: string) => {
    try{
        const authRecord = await admin.auth().createUser({
            uid: email,
            email: email,
            password: "Winetopia2025", // change this to variable in the furture.
        });
        logger.info("✅ User created:", authRecord.email);
        await createNewUserRecord(email, first_name, last_name, phone, ticket_type, ticket_number);
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
        const target_ticket = await admin.firestore().collection(ticket_collection).doc(ticket_number).get();
        if(target_ticket.exists){
            logger.info("Found an exist ticket under number: ", ticket_number);
        }
        else{
            logger.info("New ticket number: ", ticket_number);
        }

        return target_ticket;
    } catch (error) {
        logger.info("Error when trying to access the ticket: ", error);
        return false;
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
            // TODO: check actions and call nesseary helper fucntion
        }

        res.status(200).end();
    }
);
