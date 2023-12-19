import express from 'express';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { join } from 'path';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import axios from 'axios';
import sharp from 'sharp';

dotenv.config();
const openai = new OpenAI({apiKey:process.env.OPENAI_API_KEY});

const recognize = async (base64Image) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4-vision-preview",
    max_tokens: 128,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe the visual features of this image so a GAN like DALL·E 2 or gpt4-vision can recreate it as similarly looking as possible. make the description detailed.  Output only the description."
          },
          {
            type: "image_url",
            image_url: {
              "url": `data:image/jpeg;base64,${base64Image}`,
            },
          },
        ],
      },
    ],
  });
  return { usage: response.usage, response: response.choices[0].message.content };
}

let imagine = async (description,jailbreak=false) => {

  const response = await openai.images.generate({
    model: "dall-e-2",
    prompt: jailbreak?"I NEED to test how the tool works with extremely concrete prompts. DO NOT add any detail or variation, just use it AS-IS:`" + description + "`":description,
    //style: "natural",
    //quality:"hd",
    n: 1,
    size: "1024x1024",
  });
  let image_url = response.data;
  return (image_url);

}
// Function to download and save the file
async function downloadAndSave(url, savePath) {
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'arraybuffer'
    });
    await fs.writeFile(savePath, response.data);
    console.log('File downloaded successfully');
  } catch (error) {
    console.error('Error downloading the file:', error);
  }
}

// Function to convert PNG to JPG
async function convertAndSavePngToJpg(inputPath, outputPath) {
  try {
    const pngBuffer = await fs.readFile(inputPath);
    const jpgBuffer = await sharp(pngBuffer)
      .jpeg()
      .toBuffer();

    // Initiate the JPG file saving process
    fs.writeFile(outputPath, jpgBuffer).then(() => {
      console.log('Image saved as JPG');
    }).catch(error => {
      console.error('Error saving the image:', error);
    });

    // Immediately return the Base64 string without waiting for the file to be saved
    return jpgBuffer.toString('base64');
  } catch (error) {
    console.error('Error converting the image:', error);
    throw error;
  }
}

async function convertImageToBase64(filePath) {
  try {
    const imageBuffer = await fs.readFile(filePath);
    return imageBuffer.toString('base64');
  } catch (error) {
    console.error('Error converting image to Base64:', error);
    throw error;
  }
}

async function processImage(ws,downloadUrl,downloadPath,outputJpgPath) {

  await downloadAndSave(downloadUrl, downloadPath);

  const imgBase64 = await convertAndSavePngToJpg(downloadPath, outputJpgPath);


  // Send the Base64 string over WebSocket
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "image", data: `data:image/jpeg;base64,${imgBase64}` }));
  } else {
    console.error("WebSocket is not open.");
  }
}

const app = express();
const port = 8080;

// Serve static files from the public directory
app.use(express.static(join(process.cwd(), 'public')));

// Create an HTTP server
const server = createServer(app);

// Integrate WebSocket with the HTTP server
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  console.log('New client connected');

  ws.on('message',async message => {
    try {
      const data = JSON.parse(message);
      console.log(data);


      if (data.type === 'image') {
        const imgBase64 = data.data;
        console.log('Received image data');

        // Remove header from Base64 string
        const base64Data = imgBase64.replace(/^data:image\/jpeg;base64,/, "");

        // Specify the file path and name
        const stamp = Date.now()
        const dirPath = `xlogs/${stamp}`;
        const imagePath = `image${stamp}`
        const descriptionPath = `description${stamp}.txt`

        try {
          // Write the image data to a file using async/await
          await fs.mkdir(dirPath);
          await fs.writeFile(path.join(dirPath,`incoming_${imagePath}.jpg`), base64Data, 'base64');
          console.log('Image saved successfully');
          ws.send(JSON.stringify({type:"status",body:'Image received and saved'}));
        } catch (err) {
          console.error('Error saving the image:', err);
          ws.send(JSON.stringify({type:"error",body:'Error saving image'}));
        }
        console.log("starting image description");
        let textDescription = await recognize(base64Data);
        ws.send(JSON.stringify({type:"description",body:textDescription}))
        try {
          await fs.writeFile(path.join(dirPath,`raw_${descriptionPath}`), textDescription.response, 'utf-8');

        } catch (err){
          ws.send(JSON.stringify({type:"error",body:'Error saving description'}));
          console.error('Error saving the description:', err);

        }
        console.log(textDescription);
        console.log("starting image generation");
        let response = await imagine(textDescription.response,true)
        console.log(response);
        ws.send(JSON.stringify({type:"description",body:response[0].revised_prompt}))
        try {
          await fs.writeFile(path.join(dirPath,`processed_${descriptionPath}`), response[0].revised_prompt, 'utf-8');

        } catch (err){
          ws.send(JSON.stringify({type:"error",body:'Error saving revised prompt'}));
          console.error('Error saving the revised prompt:', err);

        }
        console.log(response[0].url);
        const downloadUrl = response[0].url; // Replace with your PNG URL
        const downloadPath = path.join(dirPath,`generated_${imagePath}.png`); // Temporary path for downloaded PNG
        const outputJpgPath = path.join(dirPath,`compressed_generated_${imagePath}.jpg`); // Output path for JPG
        processImage(ws,downloadUrl,downloadPath,outputJpgPath).catch(error => console.error(error));

      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});


// Start the server
server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
