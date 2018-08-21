
require('dotenv').config()
const { cd, exec, echo, touch, mkdir,cp } = require("shelljs")
const { readFileSync } = require("fs")
const url = require("url")
const s3 = require("s3")

let tmpfile= process.env.DOC_TMP_DIR||'/tmp/docs-aws'
require('dotenv').config()
echo("Deploying docs!!!")
mkdir(tmpfile)
mkdir(tmpfile+"/alltags")
cd(tmpfile)
exec("git init")
exec(`git clone  https://github.com/MARKETProtocol/MARKET.js.git `);
cd("MARKET.js")
let uploadToAws = () => {
  var client = s3.createClient({
    maxAsyncS3: 20,     // this is the default
    s3RetryCount: 3,    // this is the default
    s3RetryDelay: 1000, // this is the default
    multipartUploadThreshold: 20971520, // this is the default (20 MB)
    multipartUploadSize: 15728640, // this is the default (15 MB)
    s3Options: {
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey:process.env.AWS_SECRET,
      region: process.env.AWS_REGION,
      signatureVersion: 'v3',
      // endpoint: 's3.yourdomain.com',
      // sslEnabled: false
      // any other options are passed to new AWS.S3()
      // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
    },
  });

  var params = {
    localDir: tmpfile+"/alltags/",
    deleteRemoved: true, // default false, whether to remove s3 objects
                         // that have no corresponding local file.
    s3Params: {
      Bucket:process.env.AWS_BUCKET,
      Prefix: "",
      // other options supported by putObject, except Body and ContentLength.
      // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
    },
  };

  let uploader = client.uploadDir(params);

  uploader.on('error', (err) => {
    console.error("unable to sync:", err.stack);
  });

  uploader.on('progress', () =>  {
    console.log("progress", uploader.progressAmount, uploader.progressTotal);
  });

  uploader.on('end', ()=> {
    console.log("done uploading");
  });

}

exec('git tag', (code, stdout, stderr) => {
  stdout.split('\n').forEach( (tag) =>{
    exec(`git checkout tags/${tag}`)
    cp('-Rf',"docs",`${tmpfile}/alltags/${tag}`)
  })


 cd(tmpfile)
//  exec(`git clone --depth 1 https://github.com/MARKETProtocol/docs.git -b gh-pages` , (code, stdout, stderr) => {
    //cp('-Rf',"docs/*",`alltags`)
    uploadToAws()
  //});



})
