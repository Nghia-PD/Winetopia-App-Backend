/* eslint-disable */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import * as functions from "firebase-functions";
import * as fucntionsV1 from "firebase-functions/v1";
import sgMail from '@sendgrid/mail';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();
const winetopia2025_event_id = process.env.WINETOPIA2025_EVENT_ID;

admin.initializeApp();

const createNewUserRecord = async (ticket_number: string, ticket_type: string, email: string, first_name: string, last_name: string, phone: string) => {
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
        await admin.firestore().collection('Users').doc(ticket_number).set({
            ticket_number: ticket_number,
            ticket_type: ticket_type,
            email: email,
            first_name: first_name,
            last_name: last_name,
            phone: phone,
            silver_token: silver_token,
            gold_token: gold_token,
        });
        logger.info("✅ User record created in Firestore for UID: ", ticket_number);
    } catch (error) {
        logger.error("Error creating user record in Firestore", error);
    }
}

const createNewUserAuth = async (ticket_number: string, json_ticket_holder_email: string, name: string) => {
    try{
        const authRecord = await admin.auth().createUser({
            uid: ticket_number,
            email: json_ticket_holder_email,
            password: "Winetopia2025",
            displayName: name
        });
        logger.info("✅ User created:", authRecord.email); 

        return true;
    }catch (error: any){
        if(error.code === "auth/email-already-exists"){
            logger.warn("⚠️ User already exists with email:", json_ticket_holder_email);
            return false;
        }
        else{
            logger.error("Error creating user: ", error);
            //call send email function, pass in the error
            return error;
        }
    }
}

const changeEmailAuth = async (ticket_number: string, json_ticket_holder_email: string) => {
    try {
        await admin.auth().updateUser(ticket_number, {
            email: json_ticket_holder_email
        });
        return true;
    } catch (error: any) {
        if(error.code === "auth/email-already-exists"){
            logger.warn("⚠️ User already exists with email:", json_ticket_holder_email);
            return false;
        }
        else{
            return null;
        }
    }
}

// Upgrading ticket type - Flicket support upgrading ticket only!
const upgradeTicket = async (ticket_number: string, current_ticket_type: string, new_ticket_type: string) => {
    try {
        const target_account = await admin.firestore().collection("Users").doc(ticket_number).get();
        const silver_token = await target_account.get("silver_token");
        const gold_token = await target_account.get("gold_token");
        
        if(current_ticket_type.toLowerCase() == "standard" && new_ticket_type.toLocaleLowerCase() == "premium"){
            await admin.firestore().collection("Users").doc().update({
                ticket_type: new_ticket_type,
                silver_token: parseInt(silver_token) + 5,
                gold_token: parseInt(gold_token) + 1,
            });
        }
    } catch (error) {
        logger.error("Error when upgrade ticket type, ticket number: ", ticket_number);
    }
}

const overrideCurrentAccount = async (
    ticket_number: string, 
    json_ticket_type: string,
    json_ticket_holder_email: string, 
    json_ticket_holder_first_name: string, 
    json_ticket_holder_last_name: string, 
    json_ticket_holder_phone: string,
) => {
    try {
        const current_user_record = await admin.firestore().collection("Users").doc(ticket_number).get();
        const current_email = current_user_record.get("email");
        const current_ticket_type = current_user_record.get("ticket_type");
        const full_name = json_ticket_holder_first_name + " " + json_ticket_holder_last_name;
        
        if(current_email != json_ticket_holder_email){
            const flag = await changeEmailAuth(ticket_number, json_ticket_holder_email);
            if(flag){
                await admin.firestore().collection("Users").doc(ticket_number).update({
                    email: json_ticket_holder_email
                });
            }
        }

        if(current_ticket_type.toLowerCase() != json_ticket_type.toLowerCase()){
            await upgradeTicket(ticket_number, current_ticket_type, json_ticket_type);
        }

        await admin.firestore().collection("Users").doc(ticket_number).update({
            first_name: json_ticket_holder_first_name,
            last_name: json_ticket_holder_last_name,
            phone: json_ticket_holder_phone
        });

        await admin.auth().updateUser(ticket_number, {
            displayName: full_name,
        });
        
        logger.info("Update account info:", ticket_number);
    } catch (error) {
        logger.info("Error when override current account", error);
    }
}

const checkExistingTicket = async (ticket_number: string) => {
    try {
        const record = await admin.firestore().collection("Users").doc(ticket_number).get();
        return record.exists;
    } catch (error) {
        logger.error(error);
        return error;
    }
}

function checkEventId(event_id: string): boolean {
    return event_id === winetopia2025_event_id;
}

const notifyEmailHasBeenUsed = async (email: string, full_name: string) => {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
        logger.info("Missing Send Grid API key");
        throw new Error('Missing SENDGRID_API_KEY in environment variables');
    }
    sgMail.setApiKey(apiKey);
    const msg = {
        to: email,
        from: "tech@lemongrassproductions.co.nz",
        templateId: "d-48d4dae10d894e849a7e45d93fb89028",
        dynamic_template_data: {
            name: full_name,
            email: email
        }
    };
    sgMail
        .send(msg)
        .then((response) => {
        logger.info(response[0].statusCode);
        logger.info(response[0].headers);
        })
        .catch((error) => {
            logger.info(error);
    });
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
        const json_ticket_holder_details = req.body?.ticket_holder_details ?? null;
        const json_ticket_holder_email = json_ticket_holder_details?.email ?? null;
        const json_ticket_type = req.body?.ticket_type ?? null;
        const json_ticket_number = req.body?.barcode ?? null;

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
            const ticketExistFlag = await checkExistingTicket(json_ticket_number);
            if(ticketExistFlag){
                await overrideCurrentAccount(
                    json_ticket_number, 
                    json_ticket_type, 
                    json_ticket_holder_email, 
                    json_ticket_holder_details.first_name,
                    json_ticket_holder_details.last_name,
                    json_ticket_holder_details.cell_phone,
                );
            }
            else if(!ticketExistFlag){
                const full_name = json_ticket_holder_details.first_name + json_ticket_holder_details.last_name;
                const success_create_auth = await createNewUserAuth(json_ticket_number, json_ticket_holder_email, full_name);
                if(success_create_auth)
                {
                    await createNewUserRecord(
                        json_ticket_number,
                        json_ticket_type,
                        json_ticket_holder_email, 
                        json_ticket_holder_details.first_name, 
                        json_ticket_holder_details.last_name, 
                        json_ticket_holder_details.cell_phone, 
                    );
                }
                else if(!success_create_auth){
                    notifyEmailHasBeenUsed(json_ticket_holder_email, full_name);
                }
                // TODO: else{ notify Fail SetUp account}
            }
        }

        res.status(200).end();
    }
);

export const welcome = fucntionsV1.region("australia-southeast1").auth.user().onCreate((user) =>{
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
        logger.info("Missing Send Grid API key");
        throw new Error('Missing SENDGRID_API_KEY in environment variables');
    }
    sgMail.setApiKey(apiKey);
    //Send email welcome with login details and app link
    const msg = {
        to: user.email,
        from: "tech@lemongrassproductions.co.nz",
        templateId: "d-715ec7a4d4414d23a294d2b3c5a7f684",
        dynamic_template_data: {
            name: user.displayName,
            email: user.email
        }
    };
    sgMail
        .send(msg)
        .then((response) => {
        logger.info(response[0].statusCode);
        logger.info(response[0].headers);
        })
        .catch((error) => {
            logger.info(error);
        });
});
