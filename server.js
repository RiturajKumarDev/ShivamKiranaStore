require("dotenv").config();

const fs = require("fs");
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();

app.use(express.json());

app.use(cors({
    origin: true,   // allow any origin
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"]
}));

if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads");
}

const upload = multer({
    dest: "uploads/",
    limits: { fileSize: 10 * 1024 * 1024 },
});

const {
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI,
    FOLDER_ID,
    PORT = 3000,
} = process.env;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !FOLDER_ID) {
    console.error("Missing required environment variables in .env");
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

if (process.env.REFRESH_TOKEN) {
    oauth2Client.setCredentials({
        refresh_token: process.env.REFRESH_TOKEN,
    });
}

const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
});

function updateEnvFile(key, value) {
    const envPath = ".env";

    let envContent = "";
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf8");
    }

    const regex = new RegExp(`^${key}=.*$`, "m");

    if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
        envContent += `\n${key}=${value}`;
    }

    fs.writeFileSync(envPath, envContent, "utf8");
}

app.get("/api/auth/google", (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: ["https://www.googleapis.com/auth/drive.file"],
    });

    res.json({
        success: true,
        url: authUrl
    });
});

app.get("/auth/google/callback", async (req, res) => {
    try {
        const code = req.query.code;

        if (!code) {
            return res.status(400).json({
                success: false,
                message: "Authorization code missing"
            });
        }

        const { tokens } = await oauth2Client.getToken(code);

        if (tokens.refresh_token) {
            updateEnvFile("REFRESH_TOKEN", tokens.refresh_token);

            process.env.REFRESH_TOKEN = tokens.refresh_token;
            oauth2Client.setCredentials({
                refresh_token: tokens.refresh_token,
            });

            return res.json({
                success: true,
                message: "Refresh token saved in .env successfully"
            });
        }

        res.json({
            success: true,
            message: "Login successful but refresh token not received"
        });

    } catch (error) {
        console.error("AUTH ERROR:", error.response?.data || error.message);

        res.status(500).json({
            success: false,
            message: "Auth failed",
            error: error.response?.data || error.message
        });
    }
});

app.post("/api/upload", upload.single("image"), async (req, res) => {
    try {
        if (!process.env.REFRESH_TOKEN) {
            console.log("Refresh token not configured in .env");
            return res.status(500).json({
                success: false,
                message: "Refresh token not configured in .env",
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded",
            });
        }

        const filePath = req.file.path;

        const response = await drive.files.create({
            requestBody: {
                name: `${Date.now()}-${req.file.originalname}`,
                parents: [FOLDER_ID],
            },
            media: {
                mimeType: req.file.mimetype,
                body: fs.createReadStream(filePath),
            },
            fields: "id, name",
        });

        fs.unlinkSync(filePath);

        res.json({
            success: true,
            message: "Upload successful",
            fileId: response.data.id,
            fileName: response.data.name,
            url: `https://drive.google.com/file/d/${response.data.id}/view`,
        });

    } catch (error) {
        console.error("UPLOAD ERROR:", error.response?.data || error.message);

        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            success: false,
            message: "Error uploading file",
            error: error.response?.data || error.message,
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});