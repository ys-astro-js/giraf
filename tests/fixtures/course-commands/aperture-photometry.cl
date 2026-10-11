# Aperture Photometry Instruction (NGC2420) (aperture_photometry.pdf)
noao.digi
daophot

# B-Band Photometry (NGC2420b)
display NGC2420b.fits 1 fi+
daoedit NGC2420b.fits
datapars.fwhmpsf = 7.8
datapars.sigma = 22.
datapars.readnoi = 21.
datapars.epadu = 4.4
datapars.itime = 90.
fitskypars.annulus = 31
fitskypars.dannulu = 27
fitskypars.skyvalu = 3680.
photpars.aperture = 23
findpars.thresho = 5.
daofind NGC2420b NGC2420b.coo.1
phot NGC2420b NGC2420b.coo.1 NGC2420b.mag.1
tvmark 1 NGC2420b.coo.1 color=204 mark=cross
txdump 'NGC2420b.mag.1' 'ID,MAG,MERR' > 'NGC2420b.dat'

# V-Band Photometry (NGC2420v)
display NGC2420v.fits 1 fi+
daoedit NGC2420v.fits
datapars.fwhmpsf = 8.6
datapars.sigma = 18.
datapars.itime = 60.
fitskypars.annulus = 34
fitskypars.dannulu = 30
fitskypars.skyvalu = 3550.
photpars.aperture = 26
phot NGC2420v NGC2420b.coo.1 NGC2420v.mag.1
txdump 'NGC2420v.mag.1' 'ID,MAG,MERR' > 'NGC2420v.dat'
