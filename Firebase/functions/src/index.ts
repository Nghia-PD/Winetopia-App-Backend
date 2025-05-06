import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import * as functions from "firebase-functions";
import * as fucntionsV1 from "firebase-functions/v1";
import sgMail from "@sendgrid/mail";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();
const winetopia2025EventId = process.env.WINETOPIA2025_EVENT_ID;
const sendGridApiKey = process.env.SENDGRID_API_KEY;

admin.initializeApp();

const createNewUserRecord = async (
  ticketNumber: string,
  ticketType: string,
  email: string,
  firstName: string,
  lastName: string,
  phone: string
) => {
  let silverToken: number;
  let goldToken: number;

  if (ticketType.toLowerCase() == "premium") {
    silverToken = 10;
    goldToken = 1;
  } else if (ticketType.toLowerCase() == "standard") {
    silverToken = 5;
    goldToken = 0;
  } else {
    silverToken = 0;
    goldToken = 0;
  }

  try {
    await admin.firestore().collection("Users").doc(ticketNumber).set({
      ticketNumber: ticketNumber,
      ticketType: ticketType,
      email: email,
      firstName: firstName,
      lastName: lastName,
      phone: phone,
      silverToken: silverToken,
      goldToken: goldToken,
    });
    logger.info("✅ User record created in Firestore for UID: ", ticketNumber);
  } catch (error) {
    logger.error("Error creating user record in Firestore", error);
  }
};

const createNewUserAuth = async (
  ticketNumber: string,
  jsonAttendeeEmail: string,
  name: string
) => {
  try {
    const authRecord = await admin.auth().createUser({
      uid: ticketNumber,
      email: jsonAttendeeEmail,
      password: "Winetopia2025",
      displayName: name,
    });
    logger.info("✅ User created:", authRecord.email);

    return true;
  } catch (error: any) {
    if (error.code === "auth/email-already-exists") {
      logger.warn("⚠️ User already exists with email:", jsonAttendeeEmail);
      return false;
    } else {
      logger.error("Error creating user: ", error);
      // call send email function, pass in the error
      return error;
    }
  }
};

const changeEmailAuth = async (
  ticketNumber: string,
  jsonAttendeeEmail: string
) => {
  try {
    await admin.auth().updateUser(ticketNumber, {
      email: jsonAttendeeEmail,
    });
    return true;
  } catch (error: any) {
    if (error.code === "auth/email-already-exists") {
      logger.warn("⚠️ User already exists with email:", jsonAttendeeEmail);
      return false;
    } else {
      return null;
    }
  }
};

const overrideCurrentAccount = async (
  ticketNumber: string,
  jsonAttendeeEmail: string,
  jsonAttendeeFirstName: string,
  jsonAttendeeLastName: string,
  jsonAttendeePhone: string
) => {
  try {
    const currentUserRecord = await admin
      .firestore()
      .collection("Users")
      .doc(ticketNumber)
      .get();
    const currentEmail = currentUserRecord.get("email");
    const fullName = jsonAttendeeFirstName + " " + jsonAttendeeLastName;

    if (currentEmail != jsonAttendeeEmail) {
      const flag = await changeEmailAuth(ticketNumber, jsonAttendeeEmail);
      if (flag) {
        await admin.firestore().collection("Users").doc(ticketNumber).update({
          email: jsonAttendeeEmail,
        });
      }
    }

    await admin.firestore().collection("Users").doc(ticketNumber).update({
      firstName: jsonAttendeeFirstName,
      lastName: jsonAttendeeLastName,
      phone: jsonAttendeePhone,
    });

    await admin.auth().updateUser(ticketNumber, {
      displayName: fullName,
    });

    logger.info("Update account info:", ticketNumber);
  } catch (error) {
    logger.info("Error when override current account", error);
  }
};

const checkExistingTicket = async (ticketNumber: string) => {
  try {
    const record = await admin
      .firestore()
      .collection("Users")
      .doc(ticketNumber)
      .get();
    return record.exists;
  } catch (error) {
    logger.error(error);
    return error;
  }
};

const checkEventId = (eventId: string) => {
  return eventId === winetopia2025EventId;
};

const notifyEmailHasBeenUsed = async (email: string, fullName: string) => {
  if (!sendGridApiKey) {
    logger.info("Missing Send Grid API key");
    throw new Error("Missing SENDGRID_API_KEY in environment variables");
  }
  sgMail.setApiKey(sendGridApiKey);
  const msg = {
    to: email,
    from: "tech@lemongrassproductions.co.nz",
    templateId: "d-48d4dae10d894e849a7e45d93fb89028",
    dynamic_template_data: {
      name: fullName,
      email: email,
    },
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
};

export const flicketWebhookHandler = functions.https.onRequest(
  {
    region: "australia-southeast1",
  },
  async (req, res) => {
    logger.info("Webhook Received!");
    try {
      const body = req.body;
      const headers = req.headers;
      logger.info("Webhook Header:", headers);
      logger.info("Webhook Payload (JSON):", body);
    } catch (error) {
      logger.warn("Could not parse request body as JSON. Logging as text.");
      logger.info("Webhook Payload (Text):", req.body); // Fallback to text
    }

    const jsonEventId = req.body?.event_id ?? null;
    const jsonAttendeeDetails = req.body?.ticket_holder_details ?? null;
    const jsonAttendeeEmail = jsonAttendeeDetails?.email ?? null;
    const jsonTicketType = req.body?.ticket_type ?? null;
    const jsonTicketNumber = req.body?.barcode ?? null;

    if (!checkEventId(jsonEventId)) {
      logger.info("This webhook is not for Winetopia event");
    } else if (jsonAttendeeDetails == null) {
      logger.info("ticket_holder_details is null or not found!");
    } else if (jsonAttendeeEmail == null) {
      logger.info("ticket_holder_details.email is null or not found!");
    } else if (jsonTicketType == null) {
      logger.info("ticket_type is null!");
    } else if (jsonTicketNumber == null) {
      logger.info("ticket_number is null!");
    } else {
      const ticketExistFlag = await checkExistingTicket(jsonTicketNumber);
      if (ticketExistFlag) {
        await overrideCurrentAccount(
          jsonTicketNumber,
          jsonAttendeeEmail,
          jsonAttendeeDetails.first_name,
          jsonAttendeeDetails.last_name,
          jsonAttendeeDetails.cell_phone
        );
      } else if (!ticketExistFlag) {
        const fullName =
          jsonAttendeeDetails.first_name + " " + jsonAttendeeDetails.last_name;
        const successCreateAuthStatus = await createNewUserAuth(
          jsonTicketNumber,
          jsonAttendeeEmail,
          fullName
        );
        if (successCreateAuthStatus) {
          await createNewUserRecord(
            jsonTicketNumber,
            jsonTicketType,
            jsonAttendeeEmail,
            jsonAttendeeDetails.first_name,
            jsonAttendeeDetails.last_name,
            jsonAttendeeDetails.cell_phone
          );
        } else if (!successCreateAuthStatus) {
          notifyEmailHasBeenUsed(jsonAttendeeEmail, fullName);
        }
        // TODO: else{ notify Fail SetUp account}
      }
    }
    res.status(200).end();
  }
);

export const welcome = fucntionsV1
  .region("australia-southeast1")
  .auth.user()
  .onCreate((user) => {
    // const apiKey = process.env.SENDGRID_API_KEY;
    if (!sendGridApiKey) {
      logger.info("Missing Send Grid API key");
      throw new Error("Missing SENDGRID_API_KEY in environment variables");
    }
    sgMail.setApiKey(sendGridApiKey);
    // Send email welcome with login details and app link
    const msg = {
      to: user.email,
      from: "tech@lemongrassproductions.co.nz",
      templateId: "d-715ec7a4d4414d23a294d2b3c5a7f684",
      dynamic_template_data: {
        name: user.displayName,
        email: user.email,
      },
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
