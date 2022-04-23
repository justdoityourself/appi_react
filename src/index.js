import {useState} from 'react';

let bindings = {};
let callbacks = {};
let walking = {};

export function appiKeys(o)
{
  return Object.keys(o).filter(k=>!k.startsWith('_'));
}

export function appiMeta(o)
{
  return Object.keys(o).filter(k=>k.startsWith('_'));
}

export function clearBindings()
{
  bindings = {};
  callbacks = {};
}

export function walk(rid,path,mapFn,mutation)
{
  if(!(rid in walking))
    walking[rid] = {}

  if(path in walking[rid])
    return;

  walking[rid][path] = {mapFn,mutation, first:true};
}

export function bind(rid,tsx,dirty,stsx,mutation)
{
  if(rid in bindings)
    return;

  bindings[rid] = {tsx,dirty,stsx};
  callbacks[rid] = {mutation}
}

async function refreshBinding(newBindings)
{
  for(const [k,v] of Object.entries(newBindings))
  {
    if(v.dirty){
      let result = await window.AppiClient.Pull(k+".*",-1);

      if(result && result !== 22)
      {
        console.log("FAILED BIND PULL",k, result);
        continue;
      }

      let s = window.AppiClient.Get(k+".*");

      if(!s.length)
      {
        console.log("FAILED BIND GET",k);
        continue;
      }

      const json = JSON.parse(s);
      callbacks[k].mutation(json);

      for(const [path,{mapFn,mutation, first}] of Object.entries(walking?.[k] || {}))
      {
        if(!first)
          continue;

        let resolvedJson = json;

        if(path)
        {
          for(const step of path.split('/'))
          resolvedJson = resolvedJson[step];
        }

        let map = {};
        for(const key of appiKeys(resolvedJson))
        {
          const resource = mapFn ? mapFn(key) : key;

          const far = await window.AppiClient.Far(resource);

          map[key] = JSON.parse(far||"{}");
        }

        mutation(map);

        walking[k][path].first = false;
      }

      bindings[k].tsx = v.stsx;
      bindings[k].dirty = false;
    }
  }

}

export function unbind(rid)
{
  delete bindings[rid];
  delete walking[rid]
  delete callbacks[rid];
}

function realId(qid)
{
  let seg = qid.split('.');
  seg.pop();
  return seg.join('.');
}

export function walkState(qid,path,mapFn, [reactState, setReactState]) {
  walk(realId(qid),path,mapFn,(newJson)=>setReactState(newJson));

  return [reactState, setReactState];
}

export function bindState(qid, [reactState, setReactState]) {
  bind(realId(qid),0,false,0,(newJson)=>setReactState(newJson));

  let commit = (upsert)=>{
    console.log("MUTATE STATE and propagate", upsert)
  }

  return [reactState, setReactState,commit];
}

export function useAppi(qid, init){
  return bindState(qid,useState(init||{}))
}

export function useWalk(qid,path,mapFn, init){
  return walkState(qid,path,mapFn,useState(init||{}))
}

async function Poll()
{
  if(!polling)
    return;

  if(window.AppiClient)
  {
    //console.log("Bind", bindings);
    let _newBindings = await window.AppiClient.Bind(JSON.stringify(bindings));

    if(_newBindings)
    {
      let newBindings=JSON.parse(_newBindings);

      await refreshBinding(newBindings);
    }
  }

  if(polling)
    setTimeout(Poll,10000);
}

let polling = false;
function startPoll()
{
  polling = true;
  setTimeout(Poll,1000);
}

function stopPoll()
{
  polling = false;
}

export function getAppi(){
  return window.Appi;
}

export function getAppiClient(){
  return window.AppiClient;
}

export function onAppiClient(callback){
  //Use this if you want to link to appi from html
  /*<script src="/appi2.js"></script>
  <script>
    createAppi().then(async (Appi) => {
      window.Appi = Appi;
      window.AppiClient = new Appi.AppiClient("",'{"primary_host":"http://localhost:8099"}',"","");
    });
  </script>*/
  let interval = setInterval(()=>{
    const client = getAppiClient();
    if(client){
      clearInterval(interval);
      callback(client);
    }
  }, 200);
}

var onLoginEvent = undefined;
export function onLogin(callback){
  onLoginEvent=callback;
}

var onLogoutEvent = undefined;
export function onLogout(callback){
  onLogoutEvent=callback;
}

var onNoAccountEvent = undefined;
export function onNoAccount(callback){
  onNoAccountEvent=callback;
}

export function logout(){
  stopPoll();
  clearBindings();
  window.AppiClient.SetAuthenticationDetails("","","");
  //TODO remove storage
  window.localStorage.removeItem("token");
  window.localStorage.removeItem("user");
  if(onLogoutEvent)onLogoutEvent();
}

export function signup(user,password)
{
  return new Promise( (a,r) => {
    window.AppiClient.AsyncCreateUser(user,password);
    let interval = setInterval(()=>{
      let result = window.AppiClient.Ready();
      if(result !== -1)
      {
        clearInterval(interval);
        a(result);
      }
    },500)
  });
}

export async function login(user,password,token,remember)
{
  if(token){
    const result = await window.AppiClient.ValidateUser(user,"",token);
    
    if(!result){
      window.AppiClient.SetAuthenticationDetails(user,"",token);

      startPoll();

      if(onLoginEvent) onLoginEvent(window.AppiClient);
      return true;
    }
    else if (onNoAccountEvent) onNoAccountEvent();
  }
  else {
    const result = await window.AppiClient.ValidateUser(user,password,"");
    
    if(!result){
      window.AppiClient.SetAuthenticationDetails(user,password,"");

      startPoll();

      if(remember){
        window.localStorage.token = window.AppiClient.CreateUserToken();
        window.localStorage.user = user;
      }

      if(onLoginEvent) onLoginEvent(window.AppiClient);
      return true;
    }
    else if (onNoAccountEvent) onNoAccountEvent();
  }
}

export function loadAppiClient(host,callback){
  if(!host)
    host="http://localhost:8099"

  return new Promise( (a,r) => {
    if(window.AppiClient)
    {
      a(window.AppiClient);
      if(callback) callback(window.AppiClient);
      return;
    }

    const appiScript = document.createElement('script');
    appiScript.onload = async (e) => 
    {
      const Appi = await window.createAppi();
      await Appi.ready;
      Appi.StartupStorage();
      await Appi.storagePromise;
      
      window.Appi = Appi;
      window.AppiClient = new Appi.AppiClient("",JSON.stringify({"primary_host":host}),"");
      window.AppiClient.SetLogging(0);

      a(window.AppiClient);
      if(callback) callback(window.AppiClient);

      if(window.localStorage.token&&window.localStorage.user)
        login(window.localStorage.user,"",window.localStorage.token);
      else if (onNoAccountEvent) onNoAccountEvent();
    };
    appiScript.onerror = r;
    appiScript.src = "/appi2.js";

    document.head.appendChild(appiScript);
  });
}

let admin = undefined;
export function loadAppiAdmin(host,secret){
  if(!host)
    host="http://localhost:8099"

  if(admin) admin.delete();
  admin = new window.Appi.AppiAdmin("",JSON.stringify({"primary_host":host}));
  //admin.SetAuthenticationDetails("",secret)

  return admin;
}