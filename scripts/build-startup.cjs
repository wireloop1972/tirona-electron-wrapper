const path = require('path');
const fs = require('fs');
const game = path.resolve(process.env.BATTLEMAP_PATH || '../Battlemap');
const esbuild = require(path.join(game, 'node_modules/esbuild'));
fs.mkdirSync('dist/startup-assets', {recursive:true});
fs.copyFileSync(path.join(game,'public/images/maps/tironamapparchment.jpeg'),'dist/startup-assets/map.jpg');
fs.copyFileSync(path.join(game,'public/assets/tirona_stonebrook_tr1_cover_v2.png'),'dist/startup-assets/cover.png');
fs.copyFileSync(path.join(game,'node_modules/three/LICENSE'),'dist/startup-assets/THREE-LICENSE.txt');
esbuild.buildSync({entryPoints:['src/startup-scene.js'],bundle:true,format:'iife',target:'chrome120',
  nodePaths:[path.join(game,'node_modules')],outfile:'dist/startup-scene.js',minify:true});
