// node --env-file=.env src/scripts/setupShape.mjs [--apply]
// Reads the live Shape roster. Creates a disabled service and verified mappings only.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const normalize = value => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
try {
  if (!process.env.SHAPE_API_KEY?.trim()) throw new Error('SHAPE_API_KEY is required to verify the live user roster.');
  const response = await fetch('https://secure-api.setshape.com/api/get/users/25977', {
    headers: {Authorization: process.env.SHAPE_API_KEY.trim()}, redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Shape user lookup returned HTTP ${response.status}`);
  const {users: roster} = await response.json();
  if (!Array.isArray(roster)) throw new Error('Unexpected Shape user response');
  const users = await prisma.user.findMany({select:{id:true,name:true,email:true}});
  let service = await prisma.integrationService.findUnique({where:{slug:'shape'}});
  if (service && service.type !== 'shape') throw new Error('The shape slug belongs to another service type.');
  const fields = [
    {key:'shapeUserId',label:'Shape user ID',required:true,secret:false,sortOrder:0,helpText:'Numeric Shape user ID.'},
    {key:'shapeAssignmentField',label:'Shape department field',required:false,secret:false,sortOrder:1,placeholder:'depursLi',helpText:'depursLi (Loan Officer), depursLo (CLR), depursAa (Administration). Defaults to depursLi.'},
  ];
  console.log(`${apply ? 'Apply' : 'Dry run'}: ${service ? 'preserve existing service' : 'create disabled service'}`);
  if (!service && apply) service = await prisma.integrationService.create({data:{
    name:'Shape',slug:'shape',type:'shape',active:false,statusTrigger:'ON_ASSIGN',method:'POST_JSON',
    urlTemplate:'https://secure-api.setshape.com/api/add/new/lead/25977',requiresAssignedUser:true,allowManualSend:true,
    captureFields:[{path:'recordId',target:'shapeRecordId'}],credentialFields:{create:fields},
  }});
  if (service && apply) for (const field of fields) {
    const exists = await prisma.integrationServiceCredentialField.findFirst({where:{serviceId:service.id,key:field.key}});
    if (!exists) await prisma.integrationServiceCredentialField.create({data:{...field,serviceId:service.id}});
  }
  let matched=0;
  const matchedPortalIds = new Set();
  for (const entry of roster) {
    const emailMatches = entry.email ? users.filter(user=>normalize(user.email)===normalize(entry.email)) : [];
    const candidates = emailMatches.length ? emailMatches : users.filter(user=>normalize(user.name)===normalize(`${entry.firstname} ${entry.lastname}`));
    const departments = [...new Set(String(entry.departments || '').match(/depurs[A-Za-z]+/g) || [])];
    if(candidates.length!==1 || departments.length!==1 || !['depursLi','depursLo','depursAa'].includes(departments[0])) {
      console.log('Needs review:',entry.id,entry.firstname,entry.lastname);continue;
    }
    const userId=candidates[0].id;
    if(matchedPortalIds.has(userId)){console.log('Duplicate portal match; review:',entry.id);continue;}
    matchedPortalIds.add(userId);
    const existing=service ? await prisma.userIntegrationCredential.findUnique({where:{userId_serviceId:{userId,serviceId:service.id}}}) : null;
    const values=existing?.values || {};
    if((values.shapeUserId && values.shapeUserId!==String(entry.id)) || (values.shapeAssignmentField && values.shapeAssignmentField!==departments[0])) {
      console.log('Existing mapping conflict; preserved:',candidates[0].name);continue;
    }
    matched++;
    if(apply && service) await prisma.userIntegrationCredential.upsert({
      where:{userId_serviceId:{userId,serviceId:service.id}},
      create:{userId,serviceId:service.id,values:{shapeUserId:String(entry.id),shapeAssignmentField:departments[0]}},
      update:{values:{...values,shapeUserId:String(entry.id),shapeAssignmentField:departments[0]}},
    });
  }
  console.log(`${matched}/${roster.length} verified user and department matches. No leads sent.`);
  if(service) console.log('Service enabled:',service.active);
} finally {await prisma.$disconnect()}
