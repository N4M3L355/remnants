import OpenAI from "openai";
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({apiKey:process.env.OPENAI_API_KEY});

async function main() {

  let description = await recognize();
  console.log(description.response);
  let imageurl = await imagine(description.response,true)
  console.log(imageurl);

}
main();