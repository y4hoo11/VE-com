from glob import glob

from setuptools import find_packages, setup

package_name = 'agv_navigation'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/launch', glob('launch/*.launch.py')),
        ('share/' + package_name + '/config', glob('config/*.yaml')),
        ('share/' + package_name + '/maps', glob('maps/*')),
        ('share/' + package_name + '/behavior_trees', glob('behavior_trees/*.xml')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='VE-com team',
    maintainer_email='user@todo.todo',
    description='AGV navigation (Nav2 config, maps, waypoints, mission manager)',
    license='Apache-2.0',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'mission_manager = agv_navigation.mission_manager:main',
            'check_waypoints = agv_navigation.check_waypoints:main',
            'send_task = agv_navigation.send_task:main',
        ],
    },
)
