const {pathToFileURL}=require('node:url');
const path=require('node:path');
async function validateProjectLocation(projectPath,enumPath='Script/Const',engine='oasis-lua'){const {validateEngineProject}=await import(pathToFileURL(path.join(__dirname,'../server/engine-adapters.mjs')).href);return validateEngineProject(projectPath,enumPath,engine);}
module.exports={validateProjectLocation};
