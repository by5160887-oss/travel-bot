import { createGuard } from "../access-control.js";
export default async function handler(req,res){
 res.setHeader?.('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 try{await createGuard(process.env,req.headers).reserve('check');return res.status(200).json({ok:true})}
 catch(e){return res.status(e.status).json({error:e.error})}
}
