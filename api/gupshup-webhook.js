// Pause until durable phone-to-subscriber mapping is reviewed. No paid sends.
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 return res.status(503).json({error:'personal_access_required'});
}
