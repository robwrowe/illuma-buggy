stroller-leds/
│
├── firmware/
│ └── StrollerController/
│ ├── StrollerController.ino
│ ├── LIBRARIES.txt
│ └── PROTOCOL.md
│
├── app/
│ ├── src/
│ │ ├── components/
│ │ ├── screens/
│ │ ├── hooks/
│ │ └── services/
│ ├── app.json
│ ├── package.json
│ └── ...expo files
│
├── docs/
│ ├── architecture.md # two-board overview, data flow
│ ├── wiring.md # physical connections, power notes
│ ├── magicband.md # E9 BLE packet reference, emcot.world notes
│ ├── wled-setup.md # GLEDOPTO config, GPIO, color order
│ └── mounting.md # physical stroller build notes
│
├── assets/
│ └── diagrams/ # wiring diagrams, zone map screenshots
│
├── .gitignore
└── README.md
